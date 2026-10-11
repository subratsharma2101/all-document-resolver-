const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers/saveFlowHarness.cjs');

function hook(overrides = {}) {
  const timers = new Map(); let sequence = 0;
  const f = setup('useDraftAutosave.js', overrides, {
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  Object.assign(f.props.doc, { libraryId: 'a'.repeat(32) + '-13' });
  Object.assign(f.props, { dirty: false, revision: 0, snapshot: { text: 'Original' } });
  const change = text => { Object.assign(f.props, { dirty: true, revision: text, snapshot: { text } }); return f.render(); };
  const fire = async () => { const jobs = [...timers.values()]; timers.clear(); await Promise.all(jobs.map(job => job())); return f.flush(); };
  return { ...f, change, fire, timers };
}

test('autosave debounces typing and acknowledges only the latest revision', async () => {
  const f = hook(); f.render(); f.change('A'); f.change('Latest Hindi नमस्ते');
  assert.equal(f.timers.size, 1); assert.equal(f.stats.snapshots.length, 0);
  await f.fire();
  assert.equal(f.stats.snapshots.length, 1);
  assert.equal(f.stats.snapshots[0].snapshot.text, 'Latest Hindi नमस्ते');
  assert.equal(f.stats.draftReady.at(-1), true); assert.equal(f.stats.draftRefreshes, 1);
  f.unmount();
});

test('backgrounding and unmount both flush without waiting for the typing timer', async () => {
  const f = hook(); f.change('Background edit');
  f.stats.appStateChange('background'); await f.flush();
  assert.equal(f.stats.snapshots[0].snapshot.text, 'Background edit');
  f.change('Closing edit'); f.unmount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.stats.snapshots.at(-1).snapshot.text, 'Closing edit');
  assert.equal(f.stats.draftRefreshes, 2, 'Home refresh also happens after the editor unmounts');
});

test('finishing an older in-flight draft cannot mark a newer edit safe', async () => {
  let finish;
  const f = hook(); f.modules['./draftStorage'].saveDraft = () => new Promise(resolve => { finish = resolve; });
  f.change('Older'); f.stats.appStateChange('background');
  f.change('Newer'); finish(); await f.flush();
  assert.equal(f.stats.draftReady.at(-1), false);
  f.modules['./draftStorage'].saveDraft = async () => {};
  await f.fire(); assert.equal(f.stats.draftReady.at(-1), true);
  f.unmount();
});

test('flush waits for a copy already in progress before editor cleanup', async () => {
  let finish, cleaned = false;
  const f = hook(); f.modules['./draftStorage'].saveDraft = () => new Promise(resolve => { finish = resolve; });
  const autosave = f.change('Snapshot'); f.stats.appStateChange('background');
  const cleanup = autosave.flush().then(() => { cleaned = true; });
  await Promise.resolve(); assert.equal(cleaned, false);
  finish(); await cleanup; assert.equal(cleaned, true); f.unmount();
});

test('reverting to the original clears the stale recovery copy', async () => {
  const f = hook(); f.change('Temporary edit'); await f.fire();
  Object.assign(f.props, { dirty: false, revision: 0, snapshot: { text: 'Original' } });
  f.render(); await f.flush();
  assert.equal(f.stats.discarded.length, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.stats.draftReady.at(-1), true); f.unmount();
});

test('successful export cancels pending autosave and does not recreate a discarded draft', async () => {
  const f = hook(), autosave = f.change('Ready to export');
  await autosave.clear(); await f.fire();
  assert.equal(f.stats.snapshots.length, 0); assert.equal(f.stats.discarded.length, 1);
  f.unmount(); assert.equal(f.stats.snapshots.length, 0);
});

test('draft failures stay visible and never report the current edits as saved', async () => {
  const f = hook(); f.modules['./draftStorage'].saveDraft = async () => { throw new Error('Storage full'); };
  f.change('Unsaved'); await f.fire();
  assert.match(f.render().status, /Storage full/); assert.equal(f.stats.draftReady.at(-1), false);
  f.unmount();
});

test('an old cleanup completion cannot acknowledge an edit made while it was pending', async () => {
  let finish;
  const f = hook(); f.modules['./draftStorage'].discardDraft = () => new Promise(resolve => { finish = resolve; });
  const autosave = f.change('Old'); const clearing = autosave.clear();
  f.change('New'); finish(); await clearing;
  assert.equal(f.stats.draftReady.at(-1), false);
  await f.fire(); assert.equal(f.stats.draftReady.at(-1), true); f.unmount();
});
