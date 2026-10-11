const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const memoryFiles = require('./helpers/memoryFiles.cjs');
const utils = require('../fileUtils.cjs');
const code = transformFileSync(path.join(__dirname, '../documentJobs.js'), { configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
const doc = { uri: 'file:///cache/source.pdf', name: 'Report.pdf', kind: 'pdf' };
function setup() {
  const fs = memoryFiles(), calls = { recognize: [], render: [], keep: [], removed: [] }, faults = {};
  const native = {
    async recognize(uri, kind, page, language) {
      calls.recognize.push({ uri, kind, page, language });
      if (faults.page === page) throw new Error('Page failed');
      return { text: faults.text || `  Page ${page} नमस्ते  ` };
    },
    async renderPdfPage(uri, page, format) {
      calls.render.push({ uri, page, format });
      if (faults.page === page) throw new Error('Page failed');
      const output = { uri: `file:///cache/file-tools/${page}.${format}` };
      fs.data.set(output.uri, Buffer.from(`Pixels ${page}`)); return output;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'expo-file-system') return fs;
    if (name === './fileUtils.cjs') return utils;
    if (name === './nativeFileTools') return {
      requireFileTools: () => native,
      normalizeOcrImage: async () => { const uri = 'file:///cache/normalized.jpg'; fs.data.set(uri, Buffer.from('Normalized')); return { uri }; },
      removeGeneratedFile: uri => { calls.removed.push(uri); fs.data.delete(uri); },
    };
    if (name === './fileService') return { keepExport: async output => {
      calls.keep.push(output); if (faults.keep) throw new Error('Export full');
      const uri = `file:///documents/exports/${calls.keep.length}-${output.name}`;
      fs.data.set(uri, fs.data.get(output.uri)); return { ...output, uri };
    } };
    throw new Error(name);
  } });
  return { ...fs, calls, faults, service: module.exports };
}

test('page selection preserves explicit order and rejects duplicate, invalid and oversized ranges', () => {
  const { parseToolPages } = setup().service;
  assert.deepEqual(Array.from(parseToolPages('3-1,5', 6, 20)), [3, 2, 1, 5]);
  for (const value of ['', '0', '7', '1,1', '1-3,3', 'NaN', '1,', '1.5']) assert.throws(() => parseToolPages(value, 6, 20));
  assert.throws(() => parseToolPages('1-99999999', 99999999, 20), /up to 20/);
  assert.throws(() => parseToolPages('1', 1, Infinity), /batch size/);
});

test('OCR returns completed Hindi pages when a later page fails', async () => {
  const f = setup(); f.faults.page = 3;
  const result = await f.service.recognizeDocument(doc, [1, 2, 3, 4], 'devanagari');
  assert.equal(result.text, 'Page 1 नमस्ते\n\nPage 2 नमस्ते');
  assert.equal(result.completed, 2); assert.equal(result.total, 4); assert.match(result.error, /Page failed/);
  assert.deepEqual(f.calls.recognize.map(call => call.page), [1, 2, 3]);
});

test('image recognition uses an oriented bounded copy and always releases it without deleting the source', async () => {
  const f = setup(), image = { ...doc, kind: 'image', uri: 'file:///documents/camera.jpg' };
  f.data.set(image.uri, Buffer.from('Original')); f.faults.page = 1;
  await f.service.recognizeDocument(image, [1], 'latin');
  assert.equal(f.calls.recognize[0].uri, 'file:///cache/normalized.jpg');
  assert.equal(f.data.has('file:///cache/normalized.jpg'), false);
  assert.equal(f.data.get(image.uri).toString(), 'Original');
});

test('OCR cancellation stops before the next page and keeps completed work', async () => {
  const f = setup();
  const result = await f.service.recognizeDocument(doc, [2, 3, 4], 'latin', { cancelled: () => f.calls.recognize.length >= 1 });
  assert.equal(result.text, 'Page 2 नमस्ते'); assert.equal(result.cancelled, true);
  assert.equal(result.completed, 1); assert.equal(f.calls.recognize.length, 1);
});

test('OCR bounds accumulated UTF-8 text and rejects invalid batches before native work', async () => {
  const f = setup(); f.faults.text = 'न'.repeat(180000);
  const result = await f.service.recognizeDocument(doc, [1, 2, 3], 'devanagari');
  assert.equal(result.completed, 1); assert.match(result.error, /1 MiB/);
  for (const pages of [[], [1, 1], [0], [1.5], Array.from({ length: 21 }, (_, i) => i + 1)]) {
    await assert.rejects(f.service.recognizeDocument(doc, pages, 'latin'), /page numbers/);
  }
  await assert.rejects(f.service.recognizeDocument({ ...doc, kind: 'image' }, [2], 'latin'), /one page/);
});

test('PDF conversion keeps partial exports, cleans native files, and retries without duplicating completed pages', async () => {
  const f = setup(), cache = new Map(); f.faults.page = 2;
  const first = await f.service.exportPdfImages(doc, [1, 2, 3], 'png', { cache });
  assert.equal(first.outputs.length, 1); assert.equal(first.outputs[0].name, 'Report-page-1.png');
  assert.match(first.error, /Page failed/); assert.equal(f.data.has('file:///cache/file-tools/1.png'), false);
  f.faults.page = null;
  const retry = await f.service.exportPdfImages(doc, [1, 2, 3], 'png', { cache });
  assert.equal(retry.outputs[0].uri, first.outputs[0].uri);
  assert.equal(retry.outputs.length, 3); assert.equal(f.calls.keep.length, 3);
  assert.deepEqual(f.calls.render.map(call => call.page), [1, 2, 2, 3]);
  assert.deepEqual(f.calls.keep.map(call => call.mimeType), ['image/png', 'image/png', 'image/png']);
});

test('conversion cancellation returns ready copies and never creates later pages', async () => {
  const f = setup();
  const result = await f.service.exportPdfImages(doc, [3, 2, 1], 'jpg', { cancelled: () => f.calls.keep.length >= 1 });
  assert.equal(result.cancelled, true); assert.equal(result.completed, 1);
  assert.equal(result.outputs[0].name, 'Report-page-3.jpg');
  assert.equal(result.outputs[0].mimeType, 'image/jpeg');
});

test('failed export cleanup is bounded to native temporary output and retry can recreate a removed export', async () => {
  const f = setup(), cache = new Map(); f.faults.keep = true;
  const failed = await f.service.exportPdfImages(doc, [1], 'jpg', { cache });
  assert.equal(failed.completed, 0); assert.match(failed.error, /Export full/);
  assert.equal(cache.size, 0); assert.equal(f.data.has('file:///cache/file-tools/1.jpg'), false);
  f.faults.keep = false;
  const first = await f.service.exportPdfImages(doc, [1], 'jpg', { cache });
  f.data.delete(first.outputs[0].uri);
  const next = await f.service.exportPdfImages(doc, [1], 'jpg', { cache });
  assert.notEqual(next.outputs[0].uri, first.outputs[0].uri);
});
