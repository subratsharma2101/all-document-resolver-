const test = require('node:test');
const assert = require('node:assert/strict');
const memoryFiles = require('./helpers/memoryFiles.cjs');
const load = require('./helpers/storedJsonHarness.cjs');
const uri = 'file:///documents/settings.json';

test('Android overwrite failure after destination deletion recovers the last committed settings', async () => {
  const f = memoryFiles(), service = load(f.File), file = new f.File(uri);
  await service.writeStoredJson(file, { version: 'good' });
  Object.assign(f.faults, { commit: true, commitTarget: uri, removeTargetBeforeFailure: true });
  await assert.rejects(service.writeStoredJson(file, { version: 'next' }), /Commit failed/);
  assert.equal(f.data.has(uri), false);
  assert.equal(load(f.File).readStoredJson(file).version, 'good');
  assert.equal([...f.data.keys()].some(key => key.endsWith('.pending')), false);
  // A second failure must not replace the only valid recovery copy.
  await assert.rejects(service.writeStoredJson(file, { version: 'another' }), /Commit failed/);
  assert.equal(load(f.File).readStoredJson(file).version, 'good');
  f.faults.commit = false;
  await service.writeStoredJson(file, { version: 'recovered' });
  assert.equal(service.readStoredJson(file).version, 'recovered'); assert.equal(f.data.size, 1);
});

test('a completed destination is committed even when native move reports a cleanup error', async () => {
  const f = memoryFiles(), service = load(f.File), file = new f.File(uri);
  await service.writeStoredJson(file, { revision: 1 });
  Object.assign(f.faults, { afterCommit: true, commitTarget: uri });
  await service.writeStoredJson(file, { revision: 2 });
  assert.equal(service.readStoredJson(file).revision, 2); assert.equal(f.data.size, 1);
});

test('truncated JSON falls back to recovery and deliberate removal cannot resurrect that backup', async () => {
  const f = memoryFiles(), service = load(f.File), file = new f.File(uri);
  f.data.set(uri, Buffer.from('{"broken"')); f.data.set(uri + '.backup', Buffer.from('{"value":"safe"}'));
  assert.equal(service.readStoredJson(file).value, 'safe');
  service.removeStoredJson(file);
  assert.equal(load(f.File).readStoredJson(file), null); assert.equal(f.data.size, 0);
});

test('disk failure while staging preserves the current committed value', async () => {
  const f = memoryFiles(), service = load(f.File), file = new f.File(uri);
  await service.writeStoredJson(file, { value: 'previous' }); f.faults.write = true;
  await assert.rejects(service.writeStoredJson(file, { value: 'new' }), /Write failed/);
  assert.equal(service.readStoredJson(file).value, 'previous');
});
