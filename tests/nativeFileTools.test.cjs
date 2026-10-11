const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const memoryFiles = require('./helpers/memoryFiles.cjs');
const code = transformFileSync(path.join(__dirname, '../nativeFileTools.js'), { configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
function setup(platform = 'android', installed = true) {
  const fs = memoryFiles(), calls = { native: [], fallback: [], removed: [] }, module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'expo-file-system') return fs;
    if (name === 'react-native') return { Platform: { OS: platform } };
    if (name === 'expo-image-manipulator' || name === './safeImage') return {};
    if (name === './modules/file-tools') return { __esModule: true, default: installed ? { textToPdf: async (text, size) => {
      calls.native.push({ text, size }); return { uri: 'file:///cache/file-tools/abc-123.pdf', size: 42, pageCount: 1 };
    } } : null };
    if (name === './conversions.cjs') return { buildPdfFromText: async text => {
      calls.fallback.push(text); if (text.includes('न')) throw Object.assign(new Error('Unsupported text'), { code: 'UNSUPPORTED_TEXT' });
      return new Uint8Array([1, 2]);
    } };
    if (name === './fileService') return { newWorkingFile: name => new fs.File('file:///cache/working', name), removeWorkingFile: uri => calls.removed.push(uri) };
    throw new Error(name);
  } });
  return { ...fs, calls, service: module.exports };
}

test('Hindi PDF export uses the Android text layout module without a lossy Latin fallback', async () => {
  const f = setup();
  const pdf = await f.service.createTextPdf('नमस्ते भारत', 'Hindi.pdf');
  assert.equal(pdf.name, 'Hindi.pdf'); assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(f.calls.native[0].text, 'नमस्ते भारत'); assert.equal(f.calls.fallback.length, 0);
});

test('older Android builds retain Latin export and explain the missing Hindi/OCR upgrade', async () => {
  const f = setup('android', false);
  assert.equal(f.service.nativeToolsAvailable, false);
  assert.throws(() => f.service.requireFileTools(), /updated Android build/);
  assert.ok((await f.service.createTextPdf('Hello', 'English.pdf')).uri);
  await assert.rejects(f.service.createTextPdf('नमस्ते', 'Hindi.pdf'), /Hindi PDF export needs/);
});

test('native result cleanup rejects traversal and only deletes owned generated filenames', () => {
  const f = setup(), root = 'file:///cache/file-tools/';
  for (const name of ['abc-123.pdf', '../original.pdf', '%2e%2e%2foriginal.pdf', '%broken.pdf', 'notes.txt']) f.data.set(root + name, Buffer.from('Keep'));
  for (const uri of [...f.data.keys()]) f.service.removeGeneratedFile(uri);
  assert.equal(f.data.has(root + 'abc-123.pdf'), false);
  assert.equal(f.data.size, 4); assert.equal(f.calls.removed.length, 0);
  f.service.removeGeneratedFile(undefined);
});
