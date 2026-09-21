const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const path = require('node:path');
const utils = require('../fileUtils.cjs');

const { code } = transformFileSync(path.join(__dirname, '../fileService.js'), {
  configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function setup() {
  const data = new Map(), folders = new Set(['file:///cache', 'file:///documents']);
  const saf = { granted: true, directoryUri: 'content://selected', deleted: [] };
  class File {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get name() { return this.uri.split('/').pop(); }
    get size() { return data.get(this.uri)?.length || 0; }
    get exists() { return data.has(this.uri); }
    get type() { return this.name.endsWith('.txt') ? 'text/plain' : 'application/pdf'; }
    get modificationTime() { return Date.now(); }
    async text() { return data.get(this.uri).toString(); }
    async base64() { return data.get(this.uri).toString('base64'); }
    async copy(destination) {
      if (!this.exists) throw new Error('Missing source');
      if (destination.exists) throw new Error('Would overwrite existing file');
      data.set(destination.uri, Buffer.from(data.get(this.uri)));
    }
    write(content) { data.set(this.uri, Buffer.from(content)); }
    delete() { data.delete(this.uri); }
  }
  class Directory {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get exists() { return folders.has(this.uri); }
    create() { folders.add(this.uri); }
    list() { return [...data.keys()].filter(uri => uri.startsWith(`${this.uri}/`)).map(uri => new File(uri)); }
  }
  const module = { exports: {} };
  const context = vm.createContext({ exports: module.exports, module, console, Date,
    require: name => {
      if (name === 'expo-file-system') return { File, Directory, Paths: { cache: new Directory('file:///cache'), document: new Directory('file:///documents') } };
      if (name === 'expo-file-system/legacy') return { EncodingType: { Base64: 'base64' }, StorageAccessFramework: {
        requestDirectoryPermissionsAsync: async () => saf,
        createFileAsync: async () => 'content://selected/new-copy',
        writeAsStringAsync: async (uri, text) => { if (saf.failWrite) throw new Error('Disk full'); data.set(uri, Buffer.from(text, 'base64')); },
        deleteAsync: async uri => saf.deleted.push(uri),
      } };
      if (name === 'expo-document-picker') return { getDocumentAsync: async () => ({ canceled: true }) };
      if (name === 'expo-sharing') return { isAvailableAsync: async () => true, shareAsync: async () => {} };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === './fileUtils.cjs') return utils;
      throw new Error(`Unexpected module ${name}`);
    },
  });
  vm.runInContext(code, context);
  return { service: module.exports, data, saf };
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
