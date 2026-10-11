const test = require('node:test');
const assert = require('node:assert/strict');
const { runInNewContext } = require('node:vm');
const { PDF_RENDER_PLAN_SCRIPT } = require('../pdfRenderPlan.cjs');
const planPdfPage = runInNewContext(PDF_RENDER_PLAN_SCRIPT + '; planPdfPage');

const pixels = surface => surface ? surface.pixelWidth * surface.pixelHeight : 0;
const total = plan => pixels(plan.preview) + pixels(plan.detail);
const zoomed = { width: 1110, height: 1526.25, density: 3, pixelBudget: 4800000,
  visible: { x: 350, y: 600, width: 370, height: 560 } };

test('fit-to-width text renders at the full screen pixel density', () => {
  const plan = planPdfPage({ width: 370, height: 508.75, density: 3, pixelBudget: 4800000,
    visible: { x: 0, y: 0, width: 370, height: 508.75 } });
  assert.equal(plan.preview.density, 3);
  assert.equal(plan.preview.pixelWidth, 1110);
  assert.equal(plan.detail, null);
});

test('300% zoom preserves screen resolution without allocating a huge full-page canvas', () => {
  const plan = planPdfPage(zoomed);
  assert.ok(plan.detail, 'high zoom needs a sharp visible region');
  assert.equal(plan.detail.density, 3);
  assert.ok(plan.detail.width < zoomed.width);
  assert.ok(plan.detail.height < zoomed.height);
  assert.ok(plan.detail.x <= zoomed.visible.x);
  assert.ok(plan.detail.y <= zoomed.visible.y);
  assert.ok(plan.detail.x + plan.detail.width >= zoomed.visible.x + zoomed.visible.width);
  assert.ok(plan.detail.y + plan.detail.height >= zoomed.visible.y + zoomed.visible.height);
  assert.ok(total(plan) <= zoomed.pixelBudget);
  assert.equal(plan.preview.width, zoomed.width, 'panning still has a whole-page preview');
});

test('5x pinch on a 3x screen keeps all 15 raster pixels per CSS pixel', () => {
  const plan = planPdfPage({ width: 370, height: 508.75, density: 15, pixelBudget: 4800000,
    visible: { x: 160, y: 120, width: 78, height: 110 } });
  assert.equal(plan.detail.density, 15);
  assert.ok(total(plan) <= 4800000);
});

test('small pans reuse overscan, while distant pans and sharper zooms request a new crop', () => {
  const first = planPdfPage(zoomed);
  const smallPan = planPdfPage({ ...zoomed, previousDetail: first.detail,
    visible: { ...zoomed.visible, x: 360, y: 610 } });
  assert.equal(smallPan.detail, first.detail);
  const distantPan = planPdfPage({ ...zoomed, previousDetail: first.detail,
    visible: { ...zoomed.visible, x: 500, y: 850 } });
  assert.notEqual(distantPan.detail.key, first.detail.key);
  const sharper = planPdfPage({ ...zoomed, density: 6, previousDetail: first.detail,
    visible: { x: 350, y: 600, width: 185, height: 280 } });
  assert.equal(sharper.detail.density, 6);
  assert.notEqual(sharper.detail.key, first.detail.key);
});

test('prefetch has no detail canvas, and very tall pages still have sharp visible content', () => {
  assert.equal(planPdfPage({ ...zoomed, visible: null }).detail, null);
  const plan = planPdfPage({ width: 900, height: 90000, density: 3, pixelBudget: 4800000,
    visible: { x: 200, y: 87000, width: 390, height: 600 } });
  assert.equal(plan.detail.density, 3);
  assert.ok(plan.preview.pixelHeight <= 8192);
  assert.ok(total(plan) <= 4800000);
});

test('all page rasters plus one replacement stay within 12M pixels across zoom levels', () => {
  for (const count of [1, 2, 5, 40]) {
    for (const density of [1, 1.25, 2, 3, 6, 15]) {
      let resident = 0, largestReplacement = 0;
      for (let i = 0; i < count; i++) {
        const width = 333.3 * (i + 1), height = i % 2 ? width / 3 : width * 1.375;
        const pixelBudget = Math.floor(6000000 / count);
        const plan = planPdfPage({ width, height, density, pixelBudget,
          visible: { x: 0, y: 0, width: Math.min(width, 390), height: Math.min(height, 600) } });
        assert.ok(total(plan) <= pixelBudget);
        for (const surface of [plan.preview, plan.detail].filter(Boolean)) {
          assert.ok(surface.pixelWidth > 0 && surface.pixelWidth <= 8192);
          assert.ok(surface.pixelHeight > 0 && surface.pixelHeight <= 8192);
          largestReplacement = Math.max(largestReplacement, pixels(surface));
        }
        resident += total(plan);
      }
      assert.ok(resident + largestReplacement <= 12000000);
    }
  }
});
