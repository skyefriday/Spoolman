import { describe, expect, it } from 'vitest';
import {
	WedgeDetector,
	barcodeList,
	decodeTextExtra,
	hasBarcode,
	normalizeBarcode,
	withBarcode,
	withoutBarcode
} from './barcode';

describe('normalizeBarcode', () => {
	it('folds UPC-A and GTIN-14 to EAN-13', () => {
		expect(normalizeBarcode('012345678905')).toBe('0012345678905');
		expect(normalizeBarcode('00012345678905')).toBe('0012345678905');
		expect(normalizeBarcode('0012345678905')).toBe('0012345678905');
	});

	it('keeps other codes as read', () => {
		expect(normalizeBarcode('12345670')).toBe('12345670'); // EAN-8
		expect(normalizeBarcode('PLA-GAL-BLK-1KG')).toBe('PLA-GAL-BLK-1KG');
		expect(normalizeBarcode('10012345678902')).toBe('10012345678902'); // GTIN-14, packaging level 1
	});

	it('strips whitespace and scanner control characters', () => {
		expect(normalizeBarcode('  6971234567890\r\n')).toBe('6971234567890');
		expect(normalizeBarcode('\u00026971234567890\u0003')).toBe('6971234567890');
	});

	it('rejects what cannot be a barcode', () => {
		expect(normalizeBarcode('')).toBeNull();
		expect(normalizeBarcode('abc')).toBeNull();
		expect(normalizeBarcode('x'.repeat(65))).toBeNull();
	});
});

describe('stored barcode lists', () => {
	it('parses any separator and de-duplicates', () => {
		expect(barcodeList('0012345678905, 012345678905;6971234567890')).toEqual([
			'0012345678905',
			'6971234567890'
		]);
		expect(barcodeList(undefined)).toEqual([]);
	});

	it('matches across UPC/EAN spellings', () => {
		expect(hasBarcode('012345678905', '0012345678905')).toBe(true);
		expect(hasBarcode('6971234567890', '0012345678905')).toBe(false);
		// A substring is not a match: the server filter is a LIKE, this is the check after it.
		expect(hasBarcode('16971234567890', '6971234567890')).toBe(false);
	});

	it('adds and removes without disturbing the rest', () => {
		expect(withBarcode('', '0012345678905')).toBe('0012345678905');
		expect(withBarcode('6971234567890', '0012345678905')).toBe('6971234567890 0012345678905');
		expect(withBarcode('0012345678905', '0012345678905')).toBe('0012345678905');
		expect(withoutBarcode('6971234567890 0012345678905', '0012345678905')).toBe('6971234567890');
		expect(withoutBarcode('0012345678905', '0012345678905')).toBe('');
	});

	it('decodes JSON-encoded extra values', () => {
		expect(decodeTextExtra('"0012345678905"')).toBe('0012345678905');
		expect(decodeTextExtra(undefined)).toBe('');
		expect(decodeTextExtra('12')).toBe('');
		expect(decodeTextExtra('not json')).toBe('');
	});
});

/** Feed `text` then Enter, `gap` ms apart, starting at `start`. */
function type(d: WedgeDetector, text: string, gap: number, start = 1000): string | null {
	let t = start;
	for (const ch of text) {
		d.feed(ch, t);
		t += gap;
	}
	return d.feed('Enter', t);
}

describe('WedgeDetector', () => {
	it('reports a fast burst ended by Enter', () => {
		expect(type(new WedgeDetector(), '0012345678905', 8)).toBe('0012345678905');
	});

	it('accepts Tab as the terminator', () => {
		const d = new WedgeDetector();
		let t = 0;
		for (const ch of '0012345678905') d.feed(ch, (t += 5));
		expect(d.feed('Tab', t + 5)).toBe('0012345678905');
	});

	it('ignores human-speed typing', () => {
		expect(type(new WedgeDetector(), '0012345678905', 120)).toBeNull();
	});

	it('ignores a fast burst too short to be a barcode', () => {
		expect(type(new WedgeDetector(), 'ab', 5)).toBeNull();
	});

	it('restarts after a pause, so earlier typing does not leak into a scan', () => {
		const d = new WedgeDetector();
		d.feed('x', 0);
		d.feed('y', 100);
		expect(type(d, '6971234567890', 5, 2000)).toBe('6971234567890');
	});

	it('treats Shift as part of the burst and other named keys as a break', () => {
		const d = new WedgeDetector();
		let t = 0;
		for (const key of ['Shift', 'A', 'B', 'Shift', 'C', 'D']) d.feed(key, (t += 5));
		expect(d.feed('Enter', (t += 5))).toBe('ABCD');

		for (const key of ['1', '2', 'ArrowDown', '3', '4']) d.feed(key, (t += 5));
		expect(d.feed('Enter', t + 5)).toBeNull();
	});

	it('does not report a slow Enter after a fast burst', () => {
		const d = new WedgeDetector();
		let t = 0;
		for (const ch of '0012345678905') d.feed(ch, (t += 5));
		expect(d.feed('Enter', t + 500)).toBeNull();
	});
});
