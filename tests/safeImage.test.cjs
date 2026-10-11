const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const { code } = transformFileSync(path.join(__dirname, '../safeImage.js'), { configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] });

test('native load receives a decode bound only after validated metadata and closes handles', async () => {
  let bytes = PNG, closes = 0, released = 0, loads = 0, options;
  let width = 1;
  const exports = {};
  const context = vm.createContext({ exports, require: name => {
    if (name === 'expo-file-system') return { File: class {
      get exists() { return true; } get size() { return bytes.length; }
      open() { return { readBytes: count => bytes.subarray(0, count), close: () => closes++ }; }
    } };
    if (name === 'expo-image') return { Image: { loadAsync: async (source, supplied) => { loads++; options = supplied; return { width, height: 1, release: () => released++ }; } } };
    if (name === './imageSafety.cjs') return require('../imageSafety.cjs');
    if (name === './fileUtils.cjs') return require('../fileUtils.cjs');
    throw new Error(name);
  } });
  vm.runInContext(code, context);
  const loaded = await exports.loadBoundedImage('file:///sample.png');
  assert.equal(options.maxWidth, 3072); assert.equal(options.maxHeight, 3072);
  assert.equal(closes, 1); loaded.ref.release();
  width = 5000;
  await assert.rejects(exports.loadBoundedImage('file:///sample.png'), /safe limit/);
  assert.equal(released, 2);
  bytes = Buffer.from('bad');
  await assert.rejects(exports.loadBoundedImage('file:///bad.png'), /header/);
  assert.equal(loads, 2); assert.equal(closes, 3);
  await assert.rejects(exports.loadBoundedImage('https://example.com/test.png'), /local/);
});
