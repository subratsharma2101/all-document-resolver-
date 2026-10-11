const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, elements, button, menu, menuItem, menuItems } = require('./helpers/saveFlowHarness.cjs');

async function openTextEditor(f) {
  const home = elements(f.render()).find(node => node.type === 'Dashboard');
  await home.props.onOpen('text');
  menuItem(f.render(), 'Edit this file').onPress();
  return elements(f.render()).find(node => node.type === 'TextEditor');
}

test('every document action lives in one overflow menu instead of a toolbar', async () => {
  const f = setup();
  await elements(f.render()).find(node => node.type === 'Dashboard').props.onOpen();
  let tree = f.render();
  assert.equal(menu(tree).props.visible, false, 'the menu stays closed until it is opened');
  assert.equal(elements(tree).some(node => node.props?.label === 'Save'), false, 'no competing toolbar button');
  button(tree, 'Document options').props.onPress();
  tree = f.render();
  assert.equal(menu(tree).props.visible, true);
  // Array.from keeps the comparison in this realm; the menu is built inside the VM.
  assert.deepEqual(Array.from(menuItems(tree), item => item.label),
    ['Edit this file', 'Save to phone', 'Share a copy', 'Add to starred', 'Remove app copy']);
  assert.equal(menuItem(tree, 'Remove app copy').destructive, true);
  // Choosing an action always closes the menu again.
  menuItem(tree, 'Edit this file').onPress();
  tree = f.render();
  assert.equal(menu(tree).props.visible, false);
  assert.equal(menuItem(tree, 'Back to reading').label, 'Back to reading');
  assert.equal(menuItem(tree, 'Save to phone').disabled, true, 'saving is an editor action while editing');
});

test('editor Save writes the phone copy directly without an intermediate export modal', async () => {
  const f = setup(), editor = await openTextEditor(f);
  const saved = await editor.props.onExport({ uri: 'file:///work/edited.txt', name: 'edited.txt', mimeType: 'text/plain' });
  assert.equal(f.stats.keeps.length, 1);
  assert.equal(f.stats.saves.length, 1);
  assert.equal(saved.saveStatus, 'saved');
  assert.match(saved.saveMessage, /saved to Documents/);
  assert.equal(elements(f.render()).some(node => node.type === 'Modal'), false);
  assert.equal(f.alerts.length, 0);
});

test('retry after cancellation uses the existing app copy and never generates another export', async () => {
  const f = setup(); f.stats.statuses.push('cancelled', 'saved');
  const editor = await openTextEditor(f);
  const saved = await editor.props.onExport({ uri: 'file:///work/edited.txt', name: 'edited.txt', mimeType: 'text/plain' });
  assert.equal(saved.saveStatus, 'cancelled');
  await button(f.render(), 'Retry save').props.onPress();
  assert.equal(f.stats.keeps.length, 1);
  assert.equal(f.stats.saves.length, 2);
  assert.equal(f.stats.saves[0][0].uri, f.stats.saves[1][0].uri);
  assert.equal(elements(f.render()).some(node => node.props?.label === 'Retry save'), false);
});

test('a scan asks for output format once, then saves all pages as one batch', async () => {
  const f = setup();
  const home = elements(f.render()).find(node => node.type === 'Dashboard');
  const pending = home.props.onScan();
  await f.flush();
  assert.equal(f.alerts.length, 1);
  f.alerts[0].buttons.find(option => option.text === 'JPG images').onPress();
  await pending;
  assert.equal(f.stats.saves.length, 1);
  assert.equal(f.stats.saves[0].length, 3);
  assert.equal(f.alerts.length, 1, 'there is no second export/save confirmation');
});

test('read-only files also have a direct Save action protected against double taps', async () => {
  const f = setup();
  await elements(f.render()).find(node => node.type === 'Dashboard').props.onOpen();
  const save = menuItem(f.render(), 'Save to phone');
  await Promise.all([save.onPress(), save.onPress()]);
  assert.equal(f.stats.keeps.length, 1);
  assert.equal(f.stats.saves.length, 1);
  const done = menuItem(f.render(), 'Saved to phone');
  assert.equal(done.disabled, true);
});

test('text output disables repeat saves until edited, including a rapid double tap', async () => {
  const f = setup('TextEditor.js');
  const save = button(f.render(), 'Save text');
  await Promise.all([save.props.onPress(), save.props.onPress()]);
  assert.equal(f.stats.keeps.length, 1);
  assert.equal(button(f.render(), 'text saved').props.disabled, true);
  elements(f.render()).find(node => node.type === 'TextInput').props.onChangeText('New text');
  assert.equal(button(f.render(), 'Save text').props.disabled, false);
  assert.equal(f.stats.dirty.at(-1), true);
  await button(f.render(), 'Save text').props.onPress();
  f.render();
  assert.equal(f.stats.keeps.length, 2);
  assert.equal(f.stats.dirty.at(-1), false, 'saved edits must not trigger another unsaved-warning prompt');
});

test('PDF Save disables repeated copies and becomes available for new edits', async () => {
  const f = setup('PdfEditor.js');
  Object.assign(f.props.doc, { uri: 'file:///source.pdf', name: 'source.pdf', mimeType: 'application/pdf', kind: 'pdf' });
  f.render(); await f.flush();
  const save = button(f.render(), 'Save');
  await Promise.all([save.props.onPress(), save.props.onPress()]);
  assert.equal(f.stats.keeps.length, 1);
  assert.equal(button(f.render(), 'Saved').props.disabled, true);
  elements(f.render()).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Page numbers or ranges').props.onChangeText('1');
  await button(f.render(), 'Rotate').props.onPress();
  assert.equal(button(f.render(), 'Save').props.disabled, false);
  assert.equal(f.stats.dirty.at(-1), true);
  await button(f.render(), 'Save').props.onPress();
  f.render();
  assert.equal(f.stats.dirty.at(-1), false);
});

test('iOS Save opens one share sheet and never claims a confirmed phone save', async () => {
  const f = setup(); f.stats.platform = 'ios';
  const editor = await openTextEditor(f);
  const saved = await editor.props.onExport({ uri: 'file:///work/edited.txt', name: 'edited.txt', mimeType: 'text/plain' });
  assert.equal(f.stats.shares.length, 1);
  assert.equal(f.stats.saves.length, 0);
  assert.equal(saved.saveStatus, 'shared');
  assert.match(saved.saveMessage, /Share sheet closed/);
  assert.doesNotMatch(saved.saveMessage, /saved to/);
});
