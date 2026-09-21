const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { buildPdfFromText, buildPdfFromImages, detectImageFormat, wrapLines, ConversionError } = require('../conversions.cjs');

const hasCode = code => err => err instanceof ConversionError && err.code === code;

// A 1x1 transparent PNG, enough for pdf-lib to embed.
const PNG_1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64'));

test('buildPdfFromText produces a valid multi-page PDF', async () => {
  const text = Array.from({ length: 400 }, (_, i) => `Line number ${i} with some words to wrap.`).join('\n');
  const bytes = await buildPdfFromText(text);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 1, 'long text should span multiple pages');
});

test('buildPdfFromText rejects empty text', async () => {
  await assert.rejects(() => buildPdfFromText('   '), hasCode('EMPTY_TEXT'));
});

test('buildPdfFromText rejects unsupported scripts', async () => {
  await assert.rejects(() => buildPdfFromText('नमस्ते'), hasCode('UNSUPPORTED_TEXT'));
});

test('wrapLines keeps lines within the max width and hard-splits long words', () => {
  // A fake monospace-ish font: every character is 10 units wide at any size.
  const font = { widthOfTextAtSize: str => str.length * 10 };
  const lines = wrapLines('aaaa bbbb cccc', font, 12, 60); // 60 units = 6 chars per line
  for (const line of lines) assert.ok(line.length <= 6, `line "${line}" fits`);
  const longWord = wrapLines('abcdefghijklmnop', font, 12, 60);
  assert.ok(longWord.length > 1, 'an over-long word is split across lines');
});

test('buildPdfFromImages makes one page per image', async () => {
  const bytes = await buildPdfFromImages([PNG_1x1, PNG_1x1, PNG_1x1]);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
});

test('buildPdfFromImages rejects an empty list', async () => {
  await assert.rejects(() => buildPdfFromImages([]), hasCode('NO_IMAGES'));
});

test('buildPdfFromImages rejects a non-image payload', async () => {
  await assert.rejects(() => buildPdfFromImages([Uint8Array.from([1, 2, 3, 4])]), hasCode('UNSUPPORTED_IMAGE'));
});

test('detectImageFormat recognizes PNG and JPEG', () => {
  assert.equal(detectImageFormat(PNG_1x1), 'png');
  assert.equal(detectImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.throws(() => detectImageFormat(Uint8Array.from([0, 1, 2, 3])), hasCode('UNSUPPORTED_IMAGE'));
});
