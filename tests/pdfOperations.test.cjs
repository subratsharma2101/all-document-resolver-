const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { applyPdfOperation, inspectPdf, detectImageFormat, PdfOperationError } = require('../pdfOperations.cjs');

async function makePdf(pageCount, { width = 200, height = 300 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([width, height]);
  return doc.save();
}

const hasCode = code => err => err instanceof PdfOperationError && err.code === code;

test('inspectPdf reports pages, geometry and warnings', async () => {
  const info = await inspectPdf(await makePdf(3));
  assert.equal(info.pageCount, 3);
  assert.equal(info.pages.length, 3);
  assert.equal(info.pages[0].rotation, 0);
  assert.equal(info.pages[0].overlayAllowed, true);
  assert.equal(info.warnings.length, 3);
});

test('extract keeps only the requested pages', async () => {
  const result = await applyPdfOperation(await makePdf(3), { type: 'extract', pages: '1,3' });
  assert.equal(result.pageCount, 2);
});

test('delete removes the requested pages but never all', async () => {
  const result = await applyPdfOperation(await makePdf(3), { type: 'delete', pages: '2' });
  assert.equal(result.pageCount, 2);
});

test('delete every page is rejected', async () => {
  const bytes = await makePdf(2);
  await assert.rejects(() => applyPdfOperation(bytes, { type: 'delete', pages: '1-2' }), hasCode('DELETE_ALL'));
});

test('rotate sets the page rotation', async () => {
  const result = await applyPdfOperation(await makePdf(2), { type: 'rotate', pages: '1', angle: 90 });
  assert.equal(result.pages[0].rotation, 90);
  assert.equal(result.pages[1].rotation, 0);
});

test('reorder must list every page exactly once', async () => {
  const result = await applyPdfOperation(await makePdf(3), { type: 'reorder', pages: '3,2,1' });
  assert.equal(result.pageCount, 3);
  const bytes = await makePdf(3);
  await assert.rejects(() => applyPdfOperation(bytes, { type: 'reorder', pages: '1,2' }), hasCode('INCOMPLETE_ORDER'));
});

test('merge appends another PDF', async () => {
  const result = await applyPdfOperation(await makePdf(3), { type: 'merge', additionalBytes: await makePdf(2) });
  assert.equal(result.pageCount, 5);
});

test('text overlay draws Latin text without changing the page count', async () => {
  const result = await applyPdfOperation(await makePdf(1), { type: 'text', page: 1, x: 0.1, y: 0.1, text: 'Hello', fontSize: 16 });
  assert.equal(result.pageCount, 1);
  assert.ok(result.bytes.byteLength > 0);
});

test('text overlay rejects unsupported scripts', async () => {
  const bytes = await makePdf(1);
  await assert.rejects(
    () => applyPdfOperation(bytes, { type: 'text', page: 1, x: 0.1, y: 0.1, text: 'नमस्ते', fontSize: 16 }),
    hasCode('UNSUPPORTED_TEXT'),
  );
});

test('highlight and signature overlays succeed on a standard page', async () => {
  const highlighted = await applyPdfOperation(await makePdf(1), { type: 'highlight', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.05 });
  assert.ok(highlighted.bytes.byteLength > 0);
  const signed = await applyPdfOperation(await makePdf(1), {
    type: 'signature', page: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.2,
    strokes: [[{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]],
  });
  assert.ok(signed.bytes.byteLength > 0);
});

test('overlays are refused on rotated pages rather than misplaced', async () => {
  const rotated = await applyPdfOperation(await makePdf(1), { type: 'rotate', pages: '1', angle: 90 });
  await assert.rejects(
    () => applyPdfOperation(rotated.bytes, { type: 'highlight', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }),
    hasCode('UNSUPPORTED_GEOMETRY'),
  );
});

test('invalid page ranges are rejected', async () => {
  const bytes = await makePdf(3);
  await assert.rejects(() => applyPdfOperation(bytes, { type: 'extract', pages: '9' }), hasCode('INVALID_RANGE'));
  await assert.rejects(() => applyPdfOperation(bytes, { type: 'extract', pages: 'abc' }), hasCode('INVALID_RANGE'));
});

test('empty and non-Uint8Array input is rejected', async () => {
  await assert.rejects(() => applyPdfOperation(new Uint8Array(0), { type: 'extract', pages: '1' }), hasCode('INVALID_PDF'));
  await assert.rejects(() => applyPdfOperation('not bytes', { type: 'extract', pages: '1' }), hasCode('INVALID_BYTES'));
});

// A 1x1 transparent PNG, enough for pdf-lib to embed in tests.
const PNG_1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64'));

test('detectImageFormat recognizes PNG and JPEG and rejects others', () => {
  assert.equal(detectImageFormat(PNG_1x1), 'png');
  assert.equal(detectImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'jpg');
  assert.throws(() => detectImageFormat(Uint8Array.from([0x47, 0x49, 0x46, 0x38])), hasCode('UNSUPPORTED_IMAGE'));
  assert.throws(() => detectImageFormat(new Uint8Array(0)), hasCode('INVALID_IMAGE'));
});

test('whiteout draws an opaque cover on a standard page', async () => {
  const result = await applyPdfOperation(await makePdf(1), { type: 'whiteout', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.05 });
  assert.ok(result.bytes.byteLength > 0);
  assert.equal(result.pageCount, 1);
});

test('image stamp embeds a PNG on a standard page', async () => {
  const result = await applyPdfOperation(await makePdf(1), { type: 'image', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2, imageBytes: PNG_1x1 });
  assert.ok(result.bytes.byteLength > 0);
});

test('image stamp rejects a non-image payload', async () => {
  const bytes = await makePdf(1);
  await assert.rejects(
    () => applyPdfOperation(bytes, { type: 'image', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2, imageBytes: Uint8Array.from([1, 2, 3, 4]) }),
    hasCode('UNSUPPORTED_IMAGE'));
});

test('whiteout is refused on rotated pages', async () => {
  const rotated = await applyPdfOperation(await makePdf(1), { type: 'rotate', pages: '1', angle: 90 });
  await assert.rejects(
    () => applyPdfOperation(rotated.bytes, { type: 'whiteout', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }),
    hasCode('UNSUPPORTED_GEOMETRY'));
});
