import { getJson } from './http';
import { mapFilament, mapVendor } from './map';
import { spoolSource } from './spoolSource';
import { FieldType } from './fields';
import { fields } from '$lib/stores/fields.svelte';
import { inventory } from '$lib/stores/inventory.svelte';
import { BARCODE_FIELD_KEY, decodeTextExtra, hasBarcode, withBarcode } from '$lib/utils/barcode';
import type { Filament } from '$lib/types';
import * as m from '$lib/paraglide/messages';

// Product barcodes live on the filament, in an ordinary text extra field. That keeps
// this feature entirely client-side — no table, no migration — and leaves the codes
// visible and editable in the filament inspector like any other custom field.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/**
 * Make sure the filament `barcode` field is defined, creating it on first use.
 *
 * The API rejects extra values for keys it has no definition for, so this has to run
 * before a barcode is first written. A field of that name created by hand as some
 * other type cannot hold a list of codes, and is reported rather than replaced.
 */
export async function ensureBarcodeField(): Promise<void> {
	if (!fields.isLoaded('filament')) await fields.load('filament');
	const defs = fields.get('filament');
	const existing = defs.find((f) => f.key === BARCODE_FIELD_KEY);
	if (existing) {
		if (existing.field_type !== FieldType.text) throw new Error(m['barcode.field.wrongType']());
		return;
	}
	await fields.save('filament', BARCODE_FIELD_KEY, {
		name: m['barcode.field.name'](),
		order: defs.reduce((max, f) => Math.max(max, f.order), 0) + 1,
		field_type: FieldType.text
	});
}

/**
 * The filaments carrying `code` (normalized) in their barcode field.
 *
 * The server filter is a substring match, which is what lets one field hold several
 * codes; the exact check happens here. A 13-digit code with a leading zero is looked
 * up without it, so a value someone typed into the inspector as a 12-digit UPC-A is
 * still found — `hasBarcode` treats the two spellings as the same code.
 */
export async function findFilamentsByBarcode(code: string, signal?: AbortSignal): Promise<Filament[]> {
	if (!fields.isLoaded('filament')) await fields.load('filament');
	// No field yet means nothing has ever been linked; the API would ignore the filter
	// for an unknown key and return every filament.
	if (!fields.get('filament').some((f) => f.key === BARCODE_FIELD_KEY)) return [];

	const needle = /^0\d{12}$/.test(code) ? code.slice(1) : code;
	const items = await getJson<Json[]>('/filament', { [`extra.${BARCODE_FIELD_KEY}`]: needle }, signal);
	const out: Filament[] = [];
	for (const raw of items) {
		if (raw.vendor) inventory.upsertVendor(mapVendor(raw.vendor));
		const f = mapFilament(raw);
		inventory.upsertFilament(f);
		if (hasBarcode(decodeTextExtra(f.extra[BARCODE_FIELD_KEY]), code)) out.push(f);
	}
	return out;
}

/**
 * Add `code` to a filament's barcodes, keeping any it already has.
 *
 * Re-reads the filament first rather than trusting the cache: the merge is
 * read-modify-write on one field, and a stale copy would drop a code added elsewhere.
 */
export async function linkBarcode(filamentId: string, code: string): Promise<void> {
	await ensureBarcodeField();
	const f = await spoolSource.fetchFilament(filamentId);
	const current = f ? decodeTextExtra(f.extra[BARCODE_FIELD_KEY]) : '';
	if (hasBarcode(current, code)) return;
	await spoolSource.saveFilament(filamentId, {
		extra: { [BARCODE_FIELD_KEY]: JSON.stringify(withBarcode(current, code)) }
	});
}
