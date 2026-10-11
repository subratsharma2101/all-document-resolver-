const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const utils = require('../fileUtils.cjs');

const { code } = transformFileSync(path.join(__dirname, '../phoneStorage.js'), {
  configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function setup() {
  const data = new Map(), folders = new Map();
  const native = { platform: 'android', granted: true, directoryUri: 'content://storage/tree/primary%3ADocuments%2FFile%20Viewer',
    requests: 0, creates: [], writes: 0, deleted: [], revoked: new Set(), failWriteAt: 0, streaming: false, streamed: [], streamFailsAt: 0 };
  let serial = 0;
  const preferences = 'file:///documents/phone-save.json';
  class File {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get exists() { return data.has(this.uri); }
    get size() { return data.get(this.uri)?.length || 0; }
    textSync() { return data.get(this.uri).toString(); }
    async base64() { if (!this.exists) throw new Error('Source missing'); return data.get(this.uri).toString('base64'); }
    write(value) { if (native.failPreferences) throw new Error('Preferences full'); data.set(this.uri, Buffer.from(value)); }
    async move(destination) {
      data.delete(destination.uri); // Mirrors Expo Android's overwrite-before-rename behavior.
      if (native.failCommit && destination.uri === preferences) throw new Error('Preference commit interrupted');
      data.set(destination.uri, data.get(this.uri)); data.delete(this.uri); this.uri = destination.uri;
    }
    delete() { data.delete(this.uri); }
  }
  const saf = {
    async requestDirectoryPermissionsAsync() {
      native.requests++;
      await new Promise(resolve => setImmediate(resolve));
      if (native.granted && !folders.has(native.directoryUri)) folders.set(native.directoryUri, new Set());
      return { granted: native.granted, directoryUri: native.directoryUri };
    },
    async readDirectoryAsync(uri) {
      if (native.revoked.has(uri) || !folders.has(uri)) throw new Error('Folder unavailable');
      return [...folders.get(uri)];
    },
    async createFileAsync(directory, name, mimeType) {
      if (native.reuseUri) return native.reuseUri;
      const uri = `${directory}/document/new-${++serial}`;
      native.creates.push({ directory, name, mimeType, uri }); folders.get(directory).add(uri); data.set(uri, Buffer.alloc(0));
      return uri;
    },
    async writeAsStringAsync(uri, content) {
      native.writes++;
      if (native.writes === native.failWriteAt) { data.set(uri, Buffer.from('incomplete')); throw new Error('Disk full'); }
      data.set(uri, Buffer.from(content, 'base64'));
    },
    async deleteAsync(uri) {
      if (native.failCleanup) throw new Error('Provider offline');
      native.deleted.push(uri); data.delete(uri);
      for (const entries of folders.values()) entries.delete(uri);
    },
  };
  function load() {
    const module = { exports: {} };
    const storedJson = require('./helpers/storedJsonHarness.cjs')(File);
    vm.runInNewContext(code, { module, exports: module.exports, console, require: name => {
      if (name === 'expo-file-system') return { File, Paths: { document: 'file:///documents' } };
      if (name === 'expo-file-system/legacy') return { StorageAccessFramework: saf, EncodingType: { Base64: 'base64' } };
      if (name === 'react-native') return { Platform: { OS: native.platform } };
      if (name === './fileUtils.cjs') return utils;
      if (name === './nativeFileTools') return {
        streamToDocument: async (sourceUri, documentUri) => {
          if (!native.streaming) return false;
          native.streamed.push({ sourceUri, documentUri });
          if (native.streamFailsAt && native.streamed.length === native.streamFailsAt) throw new Error('Disk full');
          data.set(documentUri, Buffer.from(data.get(sourceUri)));
          return true;
        },
      };
      if (name === './storedJson') return storedJson;
      throw new Error(name);
    } });
    return module.exports;
  }
  function output(name = 'notes.txt', content = 'Saved bytes') {
    const uri = `file:///documents/exports/${name}`;
    data.set(uri, Buffer.from(content));
    return { uri, name, mimeType: name.endsWith('.jpg') ? 'image/jpeg' : 'text/plain', size: Buffer.byteLength(content) };
  }
  return { service: load(), restart: load, data, folders, native, output, preferences };
}

test('the native build streams the file instead of holding it as base64 in memory', async () => {
  const f = setup(); f.native.streaming = true;
  const probe = f.output('scan.jpg', 'x'.repeat(4096));
  const result = await f.service.saveOutputsToPhone([probe]);
  assert.equal(result.status, 'saved');
  assert.equal(f.native.writes, 0, 'the base64 writer is never called');
  assert.equal(f.native.streamed.length, 1);
  assert.equal(f.native.streamed[0].sourceUri, probe.uri);
  assert.equal(f.native.streamed[0].documentUri, result.saved[0].phoneUri);
  assert.equal(f.data.get(result.saved[0].phoneUri).length, 4096, 'all bytes reach the folder');
});

test('builds without the native module still save through the base64 writer', async () => {
  const f = setup(); f.native.streaming = false;
  const result = await f.service.saveOutputsToPhone([f.output()]);
  assert.equal(result.status, 'saved');
  assert.equal(f.native.streamed.length, 0);
  assert.equal(f.native.writes, 1);
  assert.equal(f.data.get(result.saved[0].phoneUri).toString(), 'Saved bytes');
});

test('a failed stream removes the new document and keeps the copy retryable', async () => {
  const f = setup(); f.native.streaming = true; f.native.streamFailsAt = 1;
  const output = f.output();
  const failed = await f.service.saveOutputsToPhone([output]);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Disk full/);
  assert.equal(f.native.deleted.length, 1, 'the half-created document is removed');
  assert.equal(f.data.get(output.uri).toString(), 'Saved bytes', 'the app copy survives');
  f.native.streamFailsAt = 0;
  const retried = await f.service.saveOutputsToPhone(failed.pending);
  assert.equal(retried.status, 'saved');
  assert.equal(f.data.get(retried.saved[0].phoneUri).toString(), 'Saved bytes');
});

test('the folder is chosen once for later saves and survives restarting the app', async () => {
  const f = setup(), a = f.output(), b = f.output('other.txt');
  const first = await f.service.saveOutputsToPhone([a]);
  assert.equal(first.status, 'saved');
  assert.equal(first.folder.label, 'Documents/File Viewer');
  assert.equal(f.native.requests, 1);
  const restarted = f.restart();
  assert.equal(restarted.getSaveFolder().uri, first.folder.uri);
  const second = await restarted.saveOutputsToPhone([b]);
  assert.equal(second.status, 'saved');
  assert.equal(f.native.requests, 1);
  assert.equal(f.data.get(second.saved[0].phoneUri).toString(), 'Saved bytes');
});

test('saving the same export again or double tapping creates only one phone copy', async () => {
  const f = setup(), output = f.output();
  const results = await Promise.all([f.service.saveOutputsToPhone([output]), f.service.saveOutputsToPhone([output])]);
  assert.equal(f.native.requests, 1);
  assert.equal(f.native.creates.length, 1);
  assert.equal(f.native.writes, 1);
  assert.equal(results[1].saved[0].alreadySaved, true);
  const again = await f.restart().saveOutputsToPhone([output]);
  assert.equal(again.saved[0].phoneUri, results[0].saved[0].phoneUri);
  assert.equal(f.native.writes, 1);
});

test('all scanned pages save in one batch with one picker and unchanged bytes', async () => {
  const f = setup(), outputs = [f.output('page-01.jpg', 'jpeg 1'), f.output('page-02.jpg', 'jpeg 2'), f.output('page-03.jpg', 'jpeg 3')];
  const progress = [];
  const result = await f.service.saveOutputsToPhone(outputs, message => progress.push(message));
  assert.equal(result.status, 'saved');
  assert.equal(result.saved.length, 3);
  assert.equal(f.native.requests, 1);
  assert.equal(progress.at(-1), 'Saving 3 of 3...');
  for (let i = 0; i < outputs.length; i++) {
    assert.deepEqual(f.data.get(result.saved[i].phoneUri), f.data.get(outputs[i].uri));
    assert.equal(f.native.creates[i].name, `page-0${i + 1}`);
    assert.equal(f.native.creates[i].mimeType, 'image/jpeg');
  }
});

test('cancelling the first folder choice creates no phone files and keeps retryable app copies', async () => {
  const f = setup(), output = f.output(); f.native.granted = false;
  const cancelled = await f.service.saveOutputsToPhone([output]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.pending[0].uri, output.uri);
  assert.equal(f.native.creates.length, 0);
  assert.equal(f.service.getSaveFolder(), null);
  assert.equal(f.data.has(output.uri), true);
  f.native.granted = true;
  assert.equal((await f.service.saveOutputsToPhone(cancelled.pending)).status, 'saved');
  assert.equal(f.native.requests, 2);
});

test('a partial batch retries only missing copies and deletes only its own failed document', async () => {
  const f = setup(), outputs = [f.output('one.txt'), f.output('two.txt'), f.output('three.txt')];
  f.native.failWriteAt = 2;
  const partial = await f.service.saveOutputsToPhone(outputs);
  assert.equal(partial.status, 'failed');
  assert.equal(partial.saved.length, 1);
  assert.equal(partial.pending.length, 2);
  assert.match(partial.error, /Disk full/);
  assert.deepEqual(f.native.deleted, [f.native.creates[1].uri]);
  const retry = await f.service.saveOutputsToPhone(outputs);
  assert.equal(retry.status, 'saved');
  assert.equal(retry.saved[0].phoneUri, partial.saved[0].phoneUri);
  assert.equal(f.native.creates.length, 4);
  assert.equal(f.native.requests, 1);
  assert.equal(f.folders.get(f.native.directoryUri).size, 3);
  for (const output of outputs) assert.equal(f.data.has(output.uri), true);
});

test('revoked folder access is reported once without automatically opening another picker', async () => {
  const f = setup(), output = f.output();
  await f.service.saveOutputsToPhone([output]);
  f.native.revoked.add(f.native.directoryUri);
  const result = await f.service.saveOutputsToPhone([output]);
  assert.equal(result.status, 'needs-folder');
  assert.equal(result.pending.length, 1);
  assert.equal(f.native.requests, 1);
  f.native.directoryUri = 'content://storage/tree/primary%3ANewFolder';
  await f.service.chooseSaveFolder();
  assert.equal((await f.service.saveOutputsToPhone(result.pending)).status, 'saved');
  assert.equal(f.native.requests, 2);
});

test('cancelled folder changes preserve the existing folder and its receipts', async () => {
  const f = setup(), output = f.output();
  const first = await f.service.saveOutputsToPhone([output]);
  f.native.granted = false;
  assert.equal(await f.service.chooseSaveFolder(), null);
  assert.equal(f.service.getSaveFolder().uri, first.folder.uri);
  const result = await f.service.saveOutputsToPhone([output]);
  assert.equal(result.saved[0].alreadySaved, true);
  assert.equal(f.native.requests, 2);
});

test('deleted external copies can be saved again without trusting stale receipts', async () => {
  const f = setup(), output = f.output();
  const first = await f.service.saveOutputsToPhone([output]);
  f.data.delete(first.saved[0].phoneUri); f.folders.get(f.native.directoryUri).delete(first.saved[0].phoneUri);
  const second = await f.service.saveOutputsToPhone([output]);
  assert.notEqual(second.saved[0].phoneUri, first.saved[0].phoneUri);
  assert.equal(f.native.requests, 1);
  assert.equal(f.native.writes, 2);
});

test('switching between folders reuses each folders own receipt', async () => {
  const f = setup(), output = f.output();
  const first = await f.service.saveOutputsToPhone([output]), oldFolder = f.native.directoryUri;
  f.native.directoryUri = 'content://storage/tree/primary%3ASecondFolder';
  await f.service.chooseSaveFolder();
  await f.service.saveOutputsToPhone([output]);
  f.native.directoryUri = oldFolder; await f.service.chooseSaveFolder();
  const returned = await f.service.saveOutputsToPhone([output]);
  assert.equal(returned.saved[0].phoneUri, first.saved[0].phoneUri);
  assert.equal(f.native.writes, 2);
});

test('an existing document returned by a provider is never overwritten or deleted', async () => {
  const f = setup(), output = f.output();
  await f.service.chooseSaveFolder();
  f.native.reuseUri = 'content://storage/older-document';
  f.folders.get(f.native.directoryUri).add(f.native.reuseUri);
  f.data.set(f.native.reuseUri, Buffer.from('older contents'));
  const result = await f.service.saveOutputsToPhone([output]);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /existing file/);
  assert.equal(f.native.writes, 0);
  assert.equal(f.native.deleted.length, 0);
  assert.equal(f.data.get(f.native.reuseUri).toString(), 'older contents');
});

test('preference failures do not turn a successful copy into another save attempt', async () => {
  const f = setup(), output = f.output(); f.native.failPreferences = true;
  const result = await f.service.saveOutputsToPhone([output]);
  assert.equal(result.status, 'saved');
  assert.equal(result.remembered, false);
  assert.equal((await f.service.saveOutputsToPhone([output])).saved[0].alreadySaved, true);
  assert.equal(f.native.writes, 1);
});

test('interrupted preference replacement preserves the folder and older receipts across restart', async () => {
  const f = setup(), first = f.output(); await f.service.saveOutputsToPhone([first]);
  f.native.failCommit = true;
  const next = await f.service.saveOutputsToPhone([f.output('next.txt')]);
  assert.equal(next.status, 'saved'); assert.equal(next.remembered, false);
  const restarted = f.restart(), again = await restarted.saveOutputsToPhone([first]);
  assert.equal(again.saved[0].alreadySaved, true); assert.equal(f.native.requests, 1);
  assert.equal(f.native.writes, 2, 'the earlier receipt survived instead of generating another phone copy');
});

test('cleanup failures disclose the partial copy while retaining the source for retry', async () => {
  const f = setup(), output = f.output(); f.native.failWriteAt = 1; f.native.failCleanup = true;
  const result = await f.service.saveOutputsToPhone([output]);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /incomplete copy may remain/);
  assert.equal(f.data.has(output.uri), true);
  assert.equal(f.service.getPhoneSaveReceipt(output), null);
});

test('missing sources fail before asking for a folder, and the next save still works', async () => {
  const f = setup(), output = f.output(); f.data.delete(output.uri);
  await assert.rejects(f.service.saveOutputsToPhone([output]), /no longer available/);
  assert.equal(f.native.requests, 0);
  assert.equal((await f.service.saveOutputsToPhone([f.output()])).status, 'saved');
});

test('iOS returns a share handoff without Android permissions or a false saved result', async () => {
  const f = setup(); f.native.platform = 'ios'; const service = f.restart();
  const result = await service.saveOutputsToPhone([f.output()]);
  assert.equal(result.status, 'share');
  assert.equal(f.native.requests, 0);
  assert.equal(f.native.writes, 0);
});
