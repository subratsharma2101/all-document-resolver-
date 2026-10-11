const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const memoryFiles = require('./helpers/memoryFiles.cjs');
const utils = require('../fileUtils.cjs');
const code = transformFileSync(path.join(__dirname, '../draftStorage.js'), { configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
const doc = { libraryId: 'a'.repeat(32) + '-8', name: 'notes.txt', kind: 'text', mimeType: 'text/plain' };

function setup(data) {
  const fs = memoryFiles(data), module = { exports: {} };
  const storedJson = require('./helpers/storedJsonHarness.cjs')(fs.File);
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'expo-file-system') return fs;
    if (name === './fileUtils.cjs') return utils;
    if (name === './listCache.cjs') return require('../listCache.cjs');
    if (name === './storedJson') return storedJson;
    if (name === './fileService') return { ensureWorkingSpace() { if (fs.faults.space) throw new Error('Storage full'); } };
    throw new Error(name);
  } });
  return { ...fs, service: module.exports };
}

test('Hindi drafts survive restart and source removal, including empty notes', async () => {
  const f = setup();
  const saved = await f.service.saveDraft(doc, { text: 'नमस्ते भारत — hello' });
  assert.equal(saved.size, Buffer.byteLength('नमस्ते भारत — hello'));
  const next = setup(f.data);
  assert.equal(next.service.readDraft(doc).text, 'नमस्ते भारत — hello');
  assert.equal(next.service.listDrafts().length, 1);
  await next.service.saveDraft(doc, { text: '' });
  assert.equal(next.service.readDraft(doc).text, '');
});

test('a failed atomic commit preserves the previous complete recovery snapshot', async () => {
  const f = setup(), old = await f.service.saveDraft(doc, { text: 'Good version' });
  f.faults.commit = true;
  await assert.rejects(f.service.saveDraft(doc, { text: 'Broken version' }), /Commit failed/);
  assert.equal(f.service.readDraft(doc).text, 'Good version');
  assert.equal(f.data.has(old.uri), true);
  assert.equal([...f.data.keys()].some(uri => uri.endsWith('.pending')), false, 'no staged metadata left behind');
  f.faults.commit = false;
  await f.service.saveDraft(doc, { text: 'Retry succeeded' });
  assert.equal(f.service.readDraft(doc).text, 'Retry succeeded');
  assert.equal(f.data.has(old.uri), false);
});

test('native overwrite interruption restores draft metadata and bytes from backup after restart', async () => {
  const f = setup(), previous = await f.service.saveDraft(doc, { text: 'Previous edit' });
  Object.assign(f.faults, { commit: true, commitTarget: 'file:///documents/drafts/' + doc.libraryId + '/draft.json', removeTargetBeforeFailure: true });
  await assert.rejects(f.service.saveDraft(doc, { text: 'Interrupted edit' }), /Commit failed/);
  assert.equal(setup(f.data).service.readDraft(doc).text, 'Previous edit');
  assert.equal(f.data.has(previous.uri), true);
  await f.service.discardDraft(doc);
  assert.equal(setup(f.data).service.readDraft(doc), null);
});

test('PDF and image recovery copies reject incomplete writes without touching sources', async () => {
  for (const kind of ['pdf', 'image']) {
    const f = setup(), original = 'file:///documents/original.' + kind, edited = 'file:///cache/edited.' + kind;
    f.data.set(original, Buffer.from('Original')); f.data.set(edited, Buffer.from('Edited bytes'));
    const document = { ...doc, kind, uri: original };
    await f.service.saveDraft(document, { uri: edited, options: { format: 'png', rotation: 90 } });
    const saved = f.service.readDraft(document);
    assert.notEqual(saved.uri, edited); assert.deepEqual(f.data.get(saved.uri), f.data.get(edited));
    f.faults.partial = true;
    await assert.rejects(f.service.saveDraft(document, { uri: edited }), /incomplete/);
    assert.equal(f.service.readDraft(document).uri, saved.uri);
    await f.service.discardDraft(document);
    assert.equal(f.service.readDraft(document), null);
    assert.equal(f.data.get(original).toString(), 'Original');
    assert.equal(f.data.get(edited).toString(), 'Edited bytes');
  }
});

test('queued replacement and discard cannot resurrect an old draft', async () => {
  const f = setup();
  await Promise.all([f.service.saveDraft(doc, { text: 'First' }), f.service.saveDraft(doc, { text: 'Latest' })]);
  assert.equal(f.service.readDraft(doc).text, 'Latest');
  await Promise.all([f.service.saveDraft(doc, { text: 'In flight' }), f.service.discardDraft(doc)]);
  assert.equal(f.service.listDrafts().length, 0);
  assert.equal(f.data.size, 0);
});

test('corrupt records and path traversal cannot recover or delete external files', async () => {
  const f = setup(), record = await f.service.saveDraft(doc, { text: 'Safe' });
  const meta = 'file:///documents/drafts/' + doc.libraryId + '/draft.json';
  f.data.set('file:///documents/original.txt', Buffer.from('Private'));
  f.data.set(meta, Buffer.from(JSON.stringify({ ...record, fileName: '../../original.txt' })));
  assert.equal(f.service.readDraft(doc), null);
  assert.equal(f.service.listDrafts().length, 0);
  await f.service.discardDraft(doc);
  await f.service.discardDraft('../../');
  await assert.rejects(f.service.saveDraft({ ...doc, libraryId: '../../' }, { text: 'bad' }), /My Files/);
  assert.equal(f.data.get('file:///documents/original.txt').toString(), 'Private');
});

test('wrong-kind and truncated snapshots are ignored, while successful replacement cleans crash leftovers', async () => {
  const f = setup(), saved = await f.service.saveDraft(doc, { text: 'Complete' });
  assert.equal(f.service.readDraft({ ...doc, kind: 'pdf' }), null);
  f.data.set(saved.uri, Buffer.from('Part'));
  assert.equal(f.service.readDraft(doc), null);
  const orphan = saved.uri.replace(/[^/]+$/, '123-4.txt'); f.data.set(orphan, Buffer.from('Orphan'));
  await f.service.saveDraft(doc, { text: 'Replacement' });
  assert.equal(f.data.has(orphan), false); assert.equal(f.data.has(saved.uri), false);
});

test('per-file limits and disk failures keep the last saved text intact', async () => {
  const f = setup(); await f.service.saveDraft(doc, { text: 'Last good' });
  await assert.rejects(f.service.saveDraft(doc, { text: 'x'.repeat(utils.LIMITS.text + 1) }), /size limit/);
  f.faults.space = true;
  await assert.rejects(f.service.saveDraft(doc, { text: 'New' }), /Storage full/);
  assert.equal(f.service.readDraft(doc).text, 'Last good');
});

test('total draft capacity rejects a new snapshot before copying any bytes', async () => {
  const f = setup();
  for (let index = 0; index < 8; index++) {
    const id = String(index).repeat(32) + '-1', base = 'file:///documents/drafts/' + id + '/';
    f.data.set(base + 'draft.json', Buffer.from(JSON.stringify({ id, kind: 'pdf', name: 'Old.pdf', fileName: '100-1.pdf', size: 25_000_000, savedAt: 1 })));
    f.data.set(base + '100-1.pdf', { length: 25_000_000 }); // Virtual size avoids a 200 MB test allocation.
  }
  await assert.rejects(f.service.saveDraft(doc, { text: 'New' }), /Draft storage is full/);
  assert.equal(f.service.listDrafts().length, 8);
});
