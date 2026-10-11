const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const utils = require('../fileUtils.cjs');
const code = transformFileSync(path.join(__dirname, '../fileLibrary.js'), {
  configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;
const indexUri = 'file:///documents/library-index.json';

function setup(data = new Map()) {
  const faults = {};
  class File {
    constructor(...parts) { this.uri = parts.map(value => value.uri || value).join('/'); }
    get exists() { return data.has(this.uri); }
    get size() { return data.get(this.uri)?.length || 0; }
    get md5() { return this.exists ? crypto.createHash('md5').update(data.get(this.uri)).digest('hex') : null; }
    open() {
      if (!this.exists) throw new Error('Open source missing');
      const bytes = data.get(this.uri);
      let closed = false, offset = 0;
      faults.openHandles = (faults.openHandles || 0) + 1;
      return {
        get offset() { return closed ? null : offset; },
        set offset(value) { offset = value; },
        readBytes(length) {
          if (closed) throw new Error('File handle is closed');
          const slice = bytes.subarray(offset, offset + length);
          offset += slice.length;
          return Uint8Array.from(slice);
        },
        close() { closed = true; faults.closedHandles = (faults.closedHandles || 0) + 1; },
      };
    }
    textSync() { if (!this.exists) throw new Error('Missing file'); return data.get(this.uri).toString(); }
    write(value) { data.set(this.uri, Buffer.from(value)); }
    async copy(destination) {
      if (destination.exists) throw new Error('Copy would overwrite');
      const bytes = data.get(this.uri);
      data.set(destination.uri, Buffer.from(faults.partial ? bytes.subarray(0, 1) : bytes));
      if (faults.copyThrow) throw new Error('Copy interrupted');
    }
    async move(destination, options = {}) {
      if (faults.commit && destination.uri === indexUri) {
        if (faults.removeTargetBeforeFailure) data.delete(destination.uri);
        throw new Error('Commit failed');
      }
      if (!this.exists) throw new Error('Move source missing');
      if (destination.exists && !options.overwrite) throw new Error('Move would overwrite');
      data.set(destination.uri, data.get(this.uri)); data.delete(this.uri); this.uri = destination.uri;
    }
    delete() { data.delete(this.uri); }
  }
  class Directory {
    constructor(...parts) { this.uri = parts.map(value => value.uri || value).join('/'); }
    create() {}
  }
  const module = { exports: {} };
  const storedJson = require('./helpers/storedJsonHarness.cjs')(File);
  vm.runInNewContext(code, { module, exports: module.exports, console, require: name => {
    if (name === 'expo-file-system') return { File, Directory, Paths: { document: 'file:///documents' } };
    if (name === './fileService') return { ensureWorkingSpace() { if (faults.space) throw new Error('Storage full'); } };
    if (name === './fileUtils.cjs') return utils;
    if (name === './fileIdentity.cjs') return require('../fileIdentity.cjs');
    if (name === './listCache.cjs') return require('../listCache.cjs');
    if (name === './storedJson') return storedJson;
    throw new Error(name);
  } });
  function doc(content = 'PDF content', name = 'report.pdf', uri = 'file:///cache/report.pdf') {
    data.set(uri, Buffer.from(content));
    return { uri, name, mimeType: 'application/pdf', size: Buffer.byteLength(content), kind: 'pdf' };
  }
  return { service: module.exports, data, faults, doc };
}

test('recent files own complete copies, preserve names and survive a restart and cache deletion', async () => {
  const f = setup(), doc = f.doc();
  const item = await f.service.rememberDocument(doc);
  assert.notEqual(item.uri, doc.uri);
  assert.ok(item.uri.endsWith('/report.pdf'));
  assert.deepEqual(f.data.get(item.uri), f.data.get(doc.uri));
  f.data.delete(doc.uri);
  const restarted = setup(f.data);
  assert.equal(restarted.service.listLibrary()[0].uri, item.uri);
});

test('reopening the same content restores reading and favorites without another copy', async () => {
  const f = setup(), doc = f.doc();
  const item = await f.service.rememberDocument(doc);
  await f.service.updateReadingState(item.id, 7, 12);
  await f.service.togglePageBookmark(item.id, 7);
  await f.service.setLibraryFavorite(item.id, true);
  const restarted = setup(f.data);
  const again = await restarted.service.rememberDocument(restarted.doc('PDF content', 'renamed-by-picker.pdf', 'file:///cache/second.pdf'));
  assert.equal(again.id, item.id);
  assert.equal(again.page, 7);
  assert.equal(again.favorite, true);
  assert.deepEqual(Array.from(again.bookmarks), [7]);
  assert.equal(restarted.service.listLibrary().length, 1);
});

test('different same-name same-size documents keep separate reading positions', async () => {
  const f = setup();
  const first = await f.service.rememberDocument(f.doc('AAAA'));
  await f.service.updateReadingState(first.id, 3, 6);
  const second = await f.service.rememberDocument(f.doc('BBBB'));
  assert.notEqual(second.id, first.id);
  assert.equal(second.page, 1);
  assert.equal(f.service.listLibrary().length, 2);
});

test('simultaneous favorite, progress and bookmark updates do not lose one another', async () => {
  const f = setup(), item = await f.service.rememberDocument(f.doc());
  await Promise.all([f.service.setLibraryFavorite(item.id, true), f.service.updateReadingState(item.id, 4, 10), f.service.togglePageBookmark(item.id, 4)]);
  const latest = f.service.listLibrary()[0];
  assert.equal(latest.favorite, true); assert.equal(latest.page, 4);
  assert.deepEqual(Array.from(latest.bookmarks), [4]);
  await f.service.togglePageBookmark(item.id, 4);
  assert.deepEqual(Array.from(f.service.getReadingState(item.id).bookmarks), []);
  await f.service.updateReadingState(item.id, 99, 10);
  assert.equal(f.service.getReadingState(item.id).page, 4);
  await assert.rejects(f.service.togglePageBookmark(item.id, 11), /Wait/);
});

test('failed partial copies and metadata commits leave no visible corrupt recent file', async () => {
  const f = setup(), doc = f.doc(); f.faults.partial = true;
  await assert.rejects(f.service.rememberDocument(doc), /incomplete/);
  assert.equal(f.service.listLibrary().length, 0);
  assert.equal([...f.data.keys()].some(uri => uri.includes('/library/')), false);
  f.faults.partial = false; f.faults.commit = true;
  await assert.rejects(f.service.rememberDocument(doc), /Commit/);
  assert.equal([...f.data.keys()].some(uri => uri.includes('/library/')), false);
  f.faults.commit = false;
  await f.service.rememberDocument(doc);
  assert.equal(f.service.listLibrary().length, 1, 'the failed queue releases for retry');
});

test('renaming changes the shareable app-copy name and keeps original bytes and progress', async () => {
  const f = setup(), doc = f.doc(), item = await f.service.rememberDocument(doc);
  await f.service.updateReadingState(item.id, 2, 5);
  const renamed = await f.service.renameLibraryDocument(item.id, 'Trip notes.pdf');
  assert.ok(renamed.uri.endsWith('/Trip notes.pdf'));
  assert.equal(renamed.page, 2);
  assert.equal(renamed.id, item.id);
  assert.equal(f.data.has(item.uri), false);
  assert.equal(f.data.get(doc.uri).toString(), 'PDF content');
  await assert.rejects(f.service.renameLibraryDocument(item.id, 'oops.jpg'), /extension/);
});

test('rename rolls back the physical file when metadata cannot be committed', async () => {
  const f = setup(), item = await f.service.rememberDocument(f.doc()); f.faults.commit = true;
  await assert.rejects(f.service.renameLibraryDocument(item.id, 'New.pdf'), /Commit/);
  assert.equal(f.data.has(item.uri), true);
  assert.equal(f.service.listLibrary()[0].name, 'report.pdf');
});

test('interrupted native index replacement preserves the original name and reading state on restart', async () => {
  const f = setup(), item = await f.service.rememberDocument(f.doc());
  await f.service.updateReadingState(item.id, 3, 5);
  Object.assign(f.faults, { commit: true, removeTargetBeforeFailure: true });
  await assert.rejects(f.service.renameLibraryDocument(item.id, 'New.pdf'), /Commit failed/);
  const reopened = setup(f.data).service.listLibrary()[0];
  assert.equal(reopened.name, 'report.pdf'); assert.equal(reopened.page, 3); assert.equal(f.data.has(item.uri), true);
});

test('interrupted rename removes its partial destination and can be retried', async () => {
  const f = setup(), item = await f.service.rememberDocument(f.doc()); f.faults.copyThrow = true;
  await assert.rejects(f.service.renameLibraryDocument(item.id, 'New.pdf'), /interrupted/);
  assert.equal(f.data.has(item.uri), true);
  assert.equal([...f.data.keys()].some(uri => uri.endsWith('/New.pdf')), false);
  f.faults.copyThrow = false;
  const renamed = await f.service.renameLibraryDocument(item.id, 'New.pdf');
  assert.ok(f.data.has(renamed.uri));
});

test('removing a recent copy leaves the source and independent exports untouched', async () => {
  const f = setup(), doc = f.doc(), item = await f.service.rememberDocument(doc);
  f.data.set('file:///documents/exports/report.pdf', Buffer.from('Export'));
  await f.service.removeLibraryDocument(item.id);
  assert.equal(f.data.has(item.uri), false);
  assert.equal(f.data.has(doc.uri), true);
  assert.equal(f.data.get('file:///documents/exports/report.pdf').toString(), 'Export');
  assert.equal(f.service.listLibrary().length, 0);
});

test('capacity and disk failures preserve existing files and do not publish another copy', async () => {
  const f = setup(), item = await f.service.rememberDocument(f.doc());
  f.faults.space = true;
  await assert.rejects(f.service.rememberDocument(f.doc('Second')), /Storage full/);
  f.faults.space = false;
  const index = JSON.parse(f.data.get(indexUri)); index[0].size = 200 * 1024 * 1024;
  f.data.set(indexUri, Buffer.from(JSON.stringify(index)));
  await assert.rejects(f.service.rememberDocument(f.doc('Second')), /My Files is full/);
  assert.equal(f.data.has(item.uri), true);
  assert.equal(f.service.listLibrary().length, 1);
});

test('malformed stored paths cannot expose or remove files outside the library', async () => {
  const f = setup(); const original = f.doc();
  f.data.set(indexUri, Buffer.from(JSON.stringify([{ id: 'a'.repeat(32) + '-11', fileName: '../../cache/report.pdf', name: 'report.pdf', kind: 'pdf', size: 11 }])));
  assert.equal(f.service.listLibrary().length, 0);
  await f.service.removeLibraryDocument('a'.repeat(32) + '-11');
  assert.equal(f.data.has(original.uri), true);
});
