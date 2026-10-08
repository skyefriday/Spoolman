import { tick } from 'svelte';
import { findFilamentsByBarcode } from '$lib/api/barcodes';
import { openSearchResult } from '$lib/library/params';
import { ui } from '$lib/stores/ui.svelte';
import { toasts } from '$lib/stores/toasts.svelte';
import { normalizeBarcode } from '$lib/utils/barcode';
import { parseSpoolCode } from '$lib/utils/spoolCode';
import * as m from '$lib/paraglide/messages';

// What a code read by a keyboard-wedge barcode scanner does. Two kinds of code come
// through one scanner:
//
//   * A Spoolman label (QR or URL) names one spool or filament — open it, exactly as
//     the camera scanner does.
//   * Anything else is taken as a product barcode, which names a filament. Scanning
//     one adds a spool of it: straight to the spool form when the code is known, or
//     via the filament picker the first time, which then remembers the code.

/**
 * Whether a dialog is open that a scan must not throw away. A finished Add-spools
 * dialog marks itself `data-scan-replaceable`, which is what lets you scan roll
 * after roll without closing anything in between.
 */
function blockingDialog(): boolean {
	const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
	return [...dialogs].some((d) => !d.hasAttribute('data-scan-replaceable'));
}

export async function handleScannedCode(raw: string): Promise<void> {
	const ref = parseSpoolCode(raw);
	const code = ref ? null : normalizeBarcode(raw);
	if (!ref && !code) return;

	if (blockingDialog()) {
		toasts.info(m['barcode.scan.busy']({ code: raw.trim() }));
		return;
	}
	if (ui.addModalOpen) {
		ui.closeAddModal();
		// Let the modal see itself close before it is opened again, so it starts over
		// rather than reopening on the step it was left on.
		await tick();
	}

	if (ref) {
		openSearchResult(ref.kind, String(ref.id));
		return;
	}

	let matches;
	try {
		matches = await findFilamentsByBarcode(code!);
	} catch (e) {
		toasts.error(m['barcode.scan.lookupFailed']({ code: code!, error: String((e as Error)?.message ?? e) }));
		return;
	}
	ui.openAddModalForBarcode(
		{ code: code!, matches: matches.length },
		matches.length === 1 ? matches[0].id : null
	);
}
