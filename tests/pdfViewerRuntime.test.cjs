const test = require('node:test');
const assert = require('node:assert/strict');
const { viewer, until, pause } = require('./helpers/pdfViewerHarness.cjs');

test('saved reading positions and native bookmark jumps navigate the continuous viewer', async t => {
  const v = await viewer({ count: 12, initialPage: 8 }); t.after(() => v.close());
  await until(() => v.messages.some(message => message.type === 'page' && message.page === 8));
  v.window.fileViewerGoToPage(3);
  await until(() => v.messages.filter(message => message.type === 'page').at(-1)?.page === 3);
  const position = v.elements.stage.scrollTop;
  for (const invalid of [-1, 0, 99, 1.5, '2']) v.window.fileViewerGoToPage(invalid);
  assert.equal(v.elements.stage.scrollTop, position);
  await until(() => v.canvas(3, 'preview'));
  assert.ok(v.metrics.peakPixels <= 12000000);
});

test('viewer draws a native-density crop at 300% and maps its PDF coordinates correctly', async t => {
  const v = await viewer({ count: 1 }); t.after(() => v.close());
  await until(() => v.canvas(1, 'preview'));
  for (let i = 0; i < 4; i++) v.zoom();
  await until(() => v.canvas(1, 'detail'));
  const detail = v.canvas(1, 'detail'), job = v.jobs.findLast(item => item.canvasContext.canvas === detail);
  assert.equal(job.transform[0], 3);
  assert.equal(job.transform[3], 3);
  assert.equal(job.transform[4], -parseFloat(detail.style.left) * 3);
  assert.equal(job.transform[5], -parseFloat(detail.style.top) * 3);
  assert.equal(job.viewport.width, 1110);
  assert.ok(parseFloat(detail.style.width) < 1110);
  assert.ok(v.metrics.peakPixels <= 12000000);
  assert.deepEqual(v.messages.filter(message => message.type === 'error'), []);
});

test('pinch and viewport panning keep the previous page visible until the sharp crop is ready', async t => {
  const v = await viewer({ count: 1, delay: 40 }); t.after(() => v.close());
  await until(() => v.canvas(1, 'preview'));
  const initial = v.canvas(1, 'preview');
  v.pinch(5, 130, 150);
  await until(() => v.metrics.active > 0);
  assert.equal(initial.parentElement, v.holder(1), 'existing page remains visible during rendering');
  await until(() => v.canvas(1, 'detail'));
  const previous = v.canvas(1, 'detail');
  assert.equal(previous.width / parseFloat(previous.style.width), 15);
  v.pinch(5, 210, 300, 'scroll');
  await until(() => v.metrics.active > 0);
  assert.equal(previous.parentElement, v.holder(1), 'pan keeps the previous crop while the new one renders');
  await until(() => v.canvas(1, 'detail') !== previous);
  const current = v.canvas(1, 'detail');
  assert.ok(parseFloat(current.style.left) > parseFloat(previous.style.left));
  assert.ok(parseFloat(current.style.top) > parseFloat(previous.style.top));
  assert.equal(previous.width, 0, 'old crop backing memory is released');
  assert.ok(v.metrics.peakPixels <= 12000000);
  assert.equal(v.metrics.peakActive, 1);
});

test('rapid page and zoom changes release stale work and never overlap raster jobs', async t => {
  const v = await viewer({ count: 40, delay: 25 }); t.after(() => v.close());
  for (const number of [25, 2, 38, 8, 30, 1, 18]) {
    v.jump(number); v.zoom(); await pause(7);
  }
  await until(() => v.canvas(18, 'preview'));
  await until(() => v.metrics.active === 0);
  assert.equal(v.metrics.peakActive, 1);
  assert.ok(v.metrics.peakPixels <= 12000000);
  assert.equal(v.canvas(1, 'preview'), undefined);
  assert.equal(v.holder(18).children.filter(el => el.className === 'page-preview').length, 1);
  assert.ok(v.elements.pages.children.filter(el => el.children.some(child => child.className === 'page-preview')).length <= 5);
});

test('many short visible pages all render within the total pixel budget', async t => {
  const v = await viewer({ count: 40, pageHeight: 20, delay: 1 }); t.after(() => v.close());
  await until(() => v.canvas(19, 'preview'));
  assert.ok(v.elements.pages.children.filter(el => el.dataset.state === 'ready').length > 5);
  assert.ok(v.metrics.peakPixels <= 12000000);
});
