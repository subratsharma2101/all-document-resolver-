const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ImageOperationError, targetBytes, guardDimensions, resolveMaxWidth, outputName, formatFor, searchQuality, scaleWidths, MAX_MEGAPIXELS,
} = require('../imageOperations.cjs');

test('targetBytes converts KB using 1 KB = 1000 bytes and rejects bad input', () => {
  assert.equal(targetBytes(400), 400000);
  assert.equal(targetBytes('50'), 50000);
  assert.throws(() => targetBytes(0), /greater than zero/);
  assert.throws(() => targetBytes('abc'), /greater than zero/);
  assert.throws(() => targetBytes(-5), /greater than zero/);
});

test('guardDimensions blocks invalid and oversized images', () => {
  assert.doesNotThrow(() => guardDimensions(100, 100));
  assert.throws(() => guardDimensions(0, 100), ImageOperationError);
  const overside = Math.ceil(Math.sqrt(MAX_MEGAPIXELS * 1e6)) + 1000;
  assert.throws(() => guardDimensions(overside, overside), /megapixels/);
});

test('resolveMaxWidth only downscales and validates bounds', () => {
  assert.equal(resolveMaxWidth('800', 1600), 800);
  assert.equal(resolveMaxWidth(2000, 1600), null); // Never upscale.
  assert.equal(resolveMaxWidth('', 1600), null);
  assert.equal(resolveMaxWidth(null, 1600), null);
  assert.throws(() => resolveMaxWidth('10', 1600), /between 16/);
});

test('outputName swaps the extension and appends -edited', () => {
  assert.equal(outputName('photo.png', 'jpeg'), 'photo-edited.jpg');
  assert.equal(outputName('scan.jpeg', 'webp'), 'scan-edited.webp');
  assert.equal(outputName('nodot', 'png'), 'nodot-edited.png');
  assert.throws(() => outputName('x', 'gif'), /JPG, PNG or WebP/);
});

test('formatFor reports lossy and alpha capabilities', () => {
  assert.equal(formatFor('jpeg').lossy, true);
  assert.equal(formatFor('jpeg').alpha, false);
  assert.equal(formatFor('png').lossy, false);
  assert.equal(formatFor('webp').alpha, true);
});

test('searchQuality finds the highest quality at or below target', async () => {
  const found = await searchQuality({ targetBytes: 500, measure: async q => 1000 * q });
  assert.equal(found.fits, true);
  assert.ok(found.size <= 500, `size ${found.size} should be <= 500`);
  assert.ok(found.quality > 0.45 && found.quality <= 0.5, `quality ${found.quality} should be near 0.5`);
});

test('searchQuality returns max quality when the whole range fits', async () => {
  const found = await searchQuality({ targetBytes: 500, measure: async q => 100 * q });
  assert.equal(found.fits, true);
  assert.equal(found.quality, 1);
});

test('searchQuality reports fits:false with the smallest result when impossible', async () => {
  const found = await searchQuality({ targetBytes: 500, measure: async q => 1000 + 1000 * q });
  assert.equal(found.fits, false);
  assert.equal(found.quality, 0.1); // Smallest achievable output.
  assert.ok(found.size > 500);
});

test('scaleWidths steps down from the start width and never upscales', () => {
  const widths = scaleWidths(4000, { steps: 6, factor: 0.7, minWidth: 64 });
  assert.equal(widths[0], 4000); // Always try full resolution first.
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] < widths[i - 1], 'strictly decreasing');
  assert.ok(widths[widths.length - 1] >= 64, 'never below minWidth');
});

test('scaleWidths returns a single width when already at or below the floor', () => {
  assert.deepEqual(scaleWidths(50, { minWidth: 64 }), [50]);
});

test('searchQuality honors cancellation', async () => {
  await assert.rejects(
    () => searchQuality({ targetBytes: 500, measure: async q => 1000 * q, shouldCancel: () => true }),
    /cancelled/i,
  );
});

test('searchQuality validates its inputs', async () => {
  await assert.rejects(() => searchQuality({ targetBytes: 0, measure: async () => 1 }), /greater than zero/);
  await assert.rejects(() => searchQuality({ targetBytes: 100 }), /measure function/);
});
