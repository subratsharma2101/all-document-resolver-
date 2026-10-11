const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, elements, button, menuItem } = require('./helpers/saveFlowHarness.cjs');
const child = (tree, type) => elements(tree).find(node => node.type === type);

test('dashboard shortcuts open the right collection and navigate to the toolkit', async () => {
  const f = setup();
  const home = child(f.render(), 'Dashboard');
  home.props.onFiles('pdf');
  const files = child(f.render(), 'FilesScreen');
  assert.equal(files.props.initialKind, 'pdf');
  assert.equal(files.props.initialCollection, 'recent');
  button(f.render(), 'Tools').props.onPress();
  assert.ok(child(f.render(), 'ToolsScreen'));
  button(f.render(), 'Home').props.onPress();
  assert.ok(child(f.render(), 'Dashboard'));
});

test('library persistence failure still opens the working document', async () => {
  const f = setup();
  f.modules['./fileLibrary'].rememberDocument = async () => { throw new Error('My Files is full'); };
  await child(f.render(), 'Dashboard').props.onOpen();
  assert.ok(child(f.render(), 'ReadingViewer'));
  assert.equal(menuItem(f.render(), 'Save to phone').disabled, false);
});

test('My Files search, type filters, sorting and batch selection operate on visible files', async () => {
  const f = setup('FilesScreen.js'), saves = [];
  Object.assign(f.props, { recent: [
    { uri: 'file:///a', name: 'Notes.pdf', kind: 'pdf', openedAt: 2 },
    { uri: 'file:///b', name: 'Notes.txt', kind: 'text', openedAt: 3 },
    { uri: 'file:///c', name: 'Receipt.pdf', kind: 'pdf', openedAt: 1 },
  ], exports: [], onSave: items => saves.push(items), disabled: false });
  f.render();
  child(f.render(), 'TextInput').props.onChangeText('note');
  button(f.render(), 'PDFs').props.onPress();
  f.render();
  assert.deepEqual(Array.from(child(f.render(), 'FlatList').props.data, item => item.name), ['Notes.pdf']);
  button(f.render(), 'Select').props.onPress();
  button(f.render(), 'Select all').props.onPress();
  button(f.render(), 'Save 1 to phone').props.onPress();
  assert.deepEqual(Array.from(saves[0], item => item.uri), ['file:///a']);
  child(f.render(), 'TextInput').props.onChangeText('Receipt'); f.render();
  assert.equal(elements(f.render()).some(node => node.props?.label === 'Save 1 to phone'), false, 'hidden selections are cleared');
});

test('reader restores the last page and flushes the latest position on background and close', async () => {
  const f = setup('ReadingViewer.js');
  Object.assign(f.props.doc, { kind: 'pdf', libraryId: 'book', name: 'Book.pdf' });
  assert.equal(child(f.render(), 'PdfViewer').props.initialPage, 4);
  child(f.render(), 'PdfViewer').props.onPageChange({ page: 6, pageCount: 8 });
  f.stats.appStateChange('background'); await f.flush();
  assert.deepEqual(Array.from(f.stats.reading[0]), ['book', 6, 8]);
  child(f.render(), 'PdfViewer').props.onPageChange({ page: 7, pageCount: 8 });
  f.unmount(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(f.stats.reading.at(-1)), ['book', 7, 8]);
});

test('bookmark actions reach the shell menu and a jump does not recreate the PDF document', async () => {
  const f = setup('ReadingViewer.js'); Object.assign(f.props.doc, { kind: 'pdf', libraryId: 'book' });
  const actions = [];
  f.props.onActionsChange = items => { actions.length = 0; actions.push(...items); };
  f.render();
  // The viewer publishes its actions instead of drawing a toolbar over the page.
  assert.deepEqual(Array.from(actions, item => item.label), ['Bookmark this page', 'Saved bookmarks']);
  assert.equal(elements(f.render()).some(node => node.props?.accessibilityLabel === 'Show bookmarks'), false);
  await actions[0].onPress();
  f.render();
  assert.equal(actions[0].label, 'Remove bookmark');
  assert.equal(actions[1].disabled, false);
  actions[1].onPress();
  button(f.render(), 'Go to bookmarked page 2').props.onPress();
  const viewer = child(f.render(), 'PdfViewer');
  assert.equal(viewer.props.jumpTo.page, 2);
  assert.equal(viewer.props.uri, f.doc.uri);
  f.unmount();
  assert.deepEqual(Array.from(actions), [], 'closing the document clears its menu actions');
});
