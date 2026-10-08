// Product barcodes (UPC/EAN printed on a spool or its box) and the keyboard-wedge
// scanners that read them.
//
// A product barcode names a *filament* — every roll of "Polymaker PLA Galaxy Black
// 1 kg" carries the same one — so it is stored on the filament, in the `barcode`
// extra field, as a space-separated list (a box and the spool label inside it do not
// always agree). Spoolman's own QR labels name a single spool and are handled by
// utils/spoolCode.ts; this module is for everything else a scanner can read.
//
// Pure module: no DOM, no API, so it can be unit tested in isolation.

/** The filament extra field holding a filament's product barcodes. */
export const BARCODE_FIELD_KEY = 'barcode';

const MIN_LENGTH = 4;
const MAX_LENGTH = 64;

/**
 * Canonical spelling of a scanned product barcode, or null if it is not one.
 *
 * Retail barcodes come in several lengths that encode the same number: a 12-digit
 * UPC-A is an EAN-13 with a leading zero, and a 14-digit GTIN-14 with a leading zero
 * is an EAN-13 too. Scanners differ in which one they report (and many can be set to
 * either), so both are folded to EAN-13 — otherwise the box scanned with one scanner
 * would be a stranger to the same box scanned with another.
 *
 * Anything else (Code 128, a QR payload) is kept as read, minus surrounding
 * whitespace, since letters in it may be significant.
 */
export function normalizeBarcode(raw: string): string | null {
	// Control characters are what a scanner sends as prefix/suffix (STX, ETX, GS…).
	// eslint-disable-next-line no-control-regex
	const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return null;
	if (/^\d+$/.test(text)) {
		if (text.length === 12) return '0' + text;
		if (text.length === 14 && text.startsWith('0')) return text.slice(1);
	}
	return text;
}

/** The barcodes held in a stored `barcode` field value, normalized. */
export function barcodeList(stored: string | null | undefined): string[] {
	if (!stored) return [];
	const out: string[] = [];
	for (const part of stored.split(/[\s,;]+/)) {
		const code = normalizeBarcode(part);
		if (code && !out.includes(code)) out.push(code);
	}
	return out;
}

/** Whether a stored `barcode` field value includes `code` (already normalized). */
export function hasBarcode(stored: string | null | undefined, code: string): boolean {
	return barcodeList(stored).includes(code);
}

/** A stored `barcode` field value with `code` added, keeping what was there. */
export function withBarcode(stored: string | null | undefined, code: string): string {
	const list = barcodeList(stored);
	if (!list.includes(code)) list.push(code);
	return list.join(' ');
}

/** A stored `barcode` field value with `code` removed; '' when nothing is left. */
export function withoutBarcode(stored: string | null | undefined, code: string): string {
	return barcodeList(stored)
		.filter((c) => c !== code)
		.join(' ');
}

/** Decode an extra-field value (a JSON-encoded string) to its text, or '' if unset. */
export function decodeTextExtra(json: string | undefined): string {
	if (json === undefined) return '';
	try {
		const v = JSON.parse(json);
		return typeof v === 'string' ? v : '';
	} catch {
		return '';
	}
}

// --- keyboard-wedge detection -------------------------------------------------
//
// A USB or Bluetooth barcode scanner presents itself as a keyboard and "types" the
// code followed by Enter. Nothing distinguishes those keystrokes from a person's
// except speed: a scanner sends a character every few milliseconds, while even a fast
// typist leaves 50 ms or more between keys. So a scan is a run of printable keys,
// each within MAX_GAP_MS of the last, ended by Enter (or Tab, the other suffix
// scanners are commonly configured to send).

/** Longest pause between two characters of one scan. */
export const MAX_GAP_MS = 50;

/**
 * Collects keystrokes and reports a scan when a fast burst ends in Enter or Tab.
 *
 * `feed` returns the scanned text on the Enter that completes one, and null for
 * every other key; the caller decides what a key was for. Slow keys restart the
 * buffer, so a person typing into the page never produces a scan.
 */
export class WedgeDetector {
	#buffer = '';
	#last = -Infinity;

	constructor(
		private readonly maxGapMs = MAX_GAP_MS,
		private readonly minLength = MIN_LENGTH
	) {}

	feed(key: string, timeMs: number): string | null {
		const fast = timeMs - this.#last <= this.maxGapMs;
		this.#last = timeMs;
		if (key === 'Enter' || key === 'Tab') {
			const scanned = fast && this.#buffer.length >= this.minLength ? this.#buffer : null;
			this.#buffer = '';
			return scanned;
		}
		if (key.length !== 1) {
			// Shift arrives before every capital and symbol a scanner types; it is part
			// of the burst, not a break in it. Any other named key ends the run.
			if (key !== 'Shift') this.#buffer = '';
			return null;
		}
		this.#buffer = fast ? this.#buffer + key : key;
		return null;
	}

	reset() {
		this.#buffer = '';
		this.#last = -Infinity;
	}
}
