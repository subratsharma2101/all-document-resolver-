const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const path = require('node:path');
const utils = require('../fileUtils.cjs');
const conversions = require('../conversions.cjs');

const { code } = transformFileSync(path.join(__dirname, '../fileService.js'), {
  configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function setup(pickerResult = { canceled: true }) {
  const data = new Map(), folders = new Set(['file:///cache', 'file:///documents']);
  const native = { renders: 0, releases: 0 };
  const saf = { granted: true, directoryUri: 'content://selected', deleted: [], available: 1024 * 1024 * 1024 };
  class File {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get name() { return this.uri.split('/').pop(); }
    get size() { return data.get(this.uri)?.length || 0; }
    get exists() { return data.has(this.uri); }
    get type() { return this.name.endsWith('.txt') ? 'text/plain' : 'application/pdf'; }
    get modificationTime() { return Date.now(); }
    async text() { return data.get(this.uri).toString(); }
    async bytes() { if (!this.exists) throw new Error('Missing source'); return data.get(this.uri); }
    async base64() { return data.get(this.uri).toString('base64'); }
    async copy(destination) {
      if (!this.exists) throw new Error('Missing source');
      if (destination.exists) throw new Error('Would overwrite existing file');
      const bytes = Buffer.from(data.get(this.uri));
      data.set(destination.uri, saf.partialCopy ? bytes.subarray(0, 1) : bytes);
    }
    async move(destination) {
      if (saf.failMove) throw new Error('Rename failed');
      if (destination.exists) throw new Error('Would overwrite existing file');
      data.set(destination.uri, data.get(this.uri)); data.delete(this.uri); this.uri = destination.uri;
    }
    write(content) { data.set(this.uri, Buffer.from(content)); }
    delete() { data.delete(this.uri); }
  }
  class Directory {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get exists() { return folders.has(this.uri); }
    create() { folders.add(this.uri); }
    list() { saf.scans = (saf.scans || 0) + 1; return [...data.keys()].filter(uri => uri.startsWith(`${this.uri}/`)).map(uri => new File(uri)); }
  }
  const module = { exports: {} };
  const context = vm.createContext({ exports: module.exports, module, console, Date,
    require: name => {
      if (name === 'expo-file-system') return { File, Directory, Paths: { cache: new Directory('file:///cache'), document: new Directory('file:///documents'), get availableDiskSpace() { return saf.available; } } };
      if (name === 'expo-file-system/legacy') return { EncodingType: { Base64: 'base64' }, StorageAccessFramework: {
        requestDirectoryPermissionsAsync: async () => saf,
        createFileAsync: async () => 'content://selected/new-copy',
        writeAsStringAsync: async (uri, text) => { if (saf.failWrite) throw new Error('Disk full'); data.set(uri, Buffer.from(text, 'base64')); },
        deleteAsync: async uri => saf.deleted.push(uri),
      } };
      if (name === 'expo-document-picker') return { getDocumentAsync: async () => pickerResult };
      if (name === 'expo-sharing') return { isAvailableAsync: async () => true, shareAsync: async () => {} };
      if (name === 'expo-image-manipulator') return { ImageManipulator: { manipulate: () => ({ resize: () => {}, release: () => native.releases++, renderAsync: async () => {
        native.renders++;
        return { width: 800, height: 600, release: () => native.releases++, saveAsync: async () => ({ uri: 'file:///cache/out.jpg' }) };
      } }) }, SaveFormat: { JPEG: 'jpeg' } };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === './listCache.cjs') return require('../listCache.cjs');
      if (name === './fileUtils.cjs') return utils;
      if (name === './conversions.cjs') return conversions;
      if (name === './imageOperations.cjs') return require('../imageOperations.cjs');
      if (name === './safeImage') return {
        inspectImageFile: () => ({ width: 800, height: 600, type: 'png' }),
        loadBoundedImage: async () => ({ ref: { release: () => native.releases++ }, width: 800, height: 600 }),
      };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  vm.runInContext(code, context);
  return { service: module.exports, data, saf, native };
}

test('imports make local working copies without modifying originals', async () => {
  const { service, data } = setup();
  data.set('content://provider/notes.txt', Buffer.from('Original text'));
  const doc = await service.importDocument({ uri: 'content://provider/notes.txt', name: 'notes.txt' });
  assert.equal(doc.text, 'Original text');
  assert.notEqual(doc.uri, 'content://provider/notes.txt');
  service.removeWorkingFile(doc.uri);
  assert.equal(data.has(doc.uri), false);
  assert.equal(data.get('content://provider/notes.txt').toString(), 'Original text');
  service.removeWorkingFile('content://provider/notes.txt');
  assert.equal(data.has('content://provider/notes.txt'), true);
});
test('remote and binary-as-text files are rejected and failed imports cleaned', async () => {
  const { service, data } = setup();
  await assert.rejects(service.importDocument({ uri: 'https://example.com/file.pdf' }), /local files/);
  await assert.rejects(service.importDocument({ uri: 'file:///missing.txt', name: 'missing.txt' }), /no longer available/);
  data.set('file:///binary.txt', Buffer.from([0, 12, 5]));
  await assert.rejects(service.importDocument({ uri: 'file:///binary.txt', name: 'binary.txt' }), /encoding/);
  assert.equal([...data.keys()].filter(uri => uri.startsWith('file:///cache/')).length, 0);
});
test('repeated export listings reuse one directory scan but never go stale', async () => {
  const { service, data, saf } = setup();
  data.set('file:///cache/result.txt', Buffer.from('Edited text'));
  const output = { uri: 'file:///cache/result.txt', name: 'notes.txt', mimeType: 'text/plain' };
  const first = await service.keepExport(output);
  saf.scans = 0;
  assert.equal(service.listExports().length, 1);
  assert.equal(service.listExports().length, 1);
  assert.equal(service.listExports().length, 1);
  assert.equal(saf.scans, 1, 'the workspace can refresh freely without rescanning');
  // Every mutation path must drop the cache, including a failed one.
  const second = await service.keepExport(output);
  assert.equal(service.listExports().length, 2);
  service.deleteExport(second.uri);
  assert.deepEqual(Array.from(service.listExports(), item => item.uri), [first.uri]);
  assert.throws(() => service.deleteExport('file:///cache/result.txt'), /Not an app export/);
  saf.available = 1;
  await assert.rejects(service.keepExport(output), /storage/);
  assert.equal(service.listExports().length, 1, 'a failed export still refreshes the list');
  assert.ok(saf.scans > 1);
});

test('exports are persistent, uniquely named and never overwrite another copy', async () => {
  const { service, data } = setup();
  data.set('file:///cache/result.txt', Buffer.from('Edited text'));
  const result = { uri: 'file:///cache/result.txt', name: 'notes.txt', mimeType: 'text/plain' };
  const first = await service.keepExport(result);
  const second = await service.keepExport(result);
  assert.match(first.uri, /documents\/exports\/notes.txt$/);
  assert.equal(second.name, 'notes (1).txt');
  assert.equal(service.listExports().length, 2);
  service.deleteExport(first.uri);
  assert.equal(service.listExports().length, 1);
  assert.throws(() => service.deleteExport('file:///cache/result.txt'), /Not an app export/);
  assert.equal(data.has(result.uri), true);
});
test('folder cancellation leaves local output and a failed write cleans new document only', async () => {
  const { service, data, saf } = setup();
  const output = { uri: 'file:///cache/result.txt', name: 'notes.txt', mimeType: 'text/plain' };
  data.set(output.uri, Buffer.from('Edited text'));
  saf.granted = false;
  assert.equal(await service.saveToFolder(output), false);
  assert.equal(data.has(output.uri), true);
  saf.granted = true;
  saf.failWrite = true;
  await assert.rejects(service.saveToFolder(output), /Disk full/);
  assert.deepEqual(saf.deleted, ['content://selected/new-copy']);
  assert.equal(data.has(output.uri), true);
});

test('image-to-PDF preparation releases native resources and generated cache files', async () => {
  const { service, data, native } = setup();
  data.set('file:///source.png', Buffer.from('source'));
  data.set('file:///cache/out.jpg', Buffer.from('jpeg bytes'));
  const bytes = await service.compressImageForPdf('file:///source.png');
  assert.equal(bytes.toString(), 'jpeg bytes');
  assert.equal(data.has('file:///cache/out.jpg'), false);
  assert.equal(data.has('file:///source.png'), true);
  assert.equal(native.releases, 3);
});

test('failed image preparation does not silently embed the original', async () => {
  const { service, data, native } = setup();
  data.set('file:///source.png', Buffer.from('source'));
  await assert.rejects(service.compressImageForPdf('file:///source.png'), /Missing source/);
  assert.equal(native.releases, 3);
  assert.equal(data.has('file:///source.png'), true);
});

test('too many selected images are rejected before decoding and picker copies are cleaned', async () => {
  const assets = Array.from({ length: 51 }, (_, i) => ({ uri: `file:///cache/photo-${i}.png` }));
  const { service, data, native } = setup({ canceled: false, assets });
  for (const asset of assets) data.set(asset.uri, Buffer.from('source'));
  await assert.rejects(service.pickImageBytes(), /up to 50/);
  assert.equal(native.renders, 0);
  assert.equal(data.size, 0);
});

test('partial copy and rename failures never appear as completed exports', async () => {
  const { service, data, saf } = setup();
  const output = { uri: 'file:///cache/result.txt', name: 'notes.txt', mimeType: 'text/plain' };
  data.set(output.uri, Buffer.from('Complete output'));
  saf.partialCopy = true;
  await assert.rejects(service.keepExport(output), /incomplete/);
  assert.equal(service.listExports().length, 0);
  saf.partialCopy = false; saf.failMove = true;
  await assert.rejects(service.keepExport(output), /Rename failed/);
  assert.equal(service.listExports().length, 0);
  assert.equal([...data.keys()].some(uri => uri.includes('export-pending')), false);
  assert.equal(data.get(output.uri).toString(), 'Complete output');
});

test('concurrent exports are serialized and recover after low-storage errors', async () => {
  const { service, data, saf } = setup();
  const output = { uri: 'file:///cache/result.txt', name: 'notes.txt', mimeType: 'text/plain' };
  data.set(output.uri, Buffer.from('Complete output'));
  saf.available = 1;
  await assert.rejects(service.keepExport(output), /storage/);
  saf.available = 100 * 1024 * 1024;
  const results = await Promise.all([service.keepExport(output), service.keepExport(output), service.keepExport(output)]);
  assert.equal(new Set(results.map(result => result.uri)).size, 3);
  assert.equal(service.listExports().length, 3);
  assert.equal([...data.keys()].some(uri => uri.includes('export-pending')), false);
});
