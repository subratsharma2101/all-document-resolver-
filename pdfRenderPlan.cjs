// Embed source verbatim: release builds must not rely on Function.toString()
// reconstructing JavaScript from Hermes bytecode. Tests run this same script.
const PDF_RENDER_PLAN_SCRIPT = `function planPdfPage({ width, height, density, pixelBudget, visible, previousDetail }) {
  const full = { x: 0, y: 0, width, height };
  function raster(rect, requestedDensity, budget) {
    // Reserve the fractional edge pixels before rounding canvas dimensions up.
    const sum = rect.width + rect.height, area = rect.width * rect.height;
    const boundedDensity = 2 * (budget - 1) / (sum + Math.sqrt(sum * sum + 4 * area * (budget - 1)));
    const scale = Math.min(requestedDensity, boundedDensity, 8192 / Math.max(rect.width, rect.height));
    const pixelWidth = Math.max(1, Math.ceil(rect.width * scale));
    const pixelHeight = Math.max(1, Math.ceil(rect.height * scale));
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, density: scale, pixelWidth, pixelHeight,
      key: [rect.x, rect.y, rect.width, rect.height, scale].join(':') };
  }
  const preview = raster(full, density, pixelBudget);
  if (!visible || preview.density >= density) return { preview, detail: null };

  // Keep a small whole-page preview behind the sharp visible region while panning.
  const fallback = raster(full, Math.min(1, density), Math.floor(pixelBudget * 0.2));
  const detailBudget = pixelBudget - fallback.pixelWidth * fallback.pixelHeight;
  const padX = visible.width * 0.12, padY = visible.height * 0.12;
  const x = Math.max(0, visible.x - padX), y = Math.max(0, visible.y - padY);
  const right = Math.min(width, visible.x + visible.width + padX);
  const bottom = Math.min(height, visible.y + visible.height + padY);
  const detail = raster({ x, y, width: right - x, height: bottom - y }, density, detailBudget);
  // Reuse the overscan until the visible area leaves it. Tiny scroll movements
  // must not continuously cancel a render or replace an already sharp canvas.
  if (previousDetail && previousDetail.density >= detail.density &&
      previousDetail.pixelWidth * previousDetail.pixelHeight <= detailBudget &&
      previousDetail.x <= visible.x && previousDetail.y <= visible.y &&
      previousDetail.x + previousDetail.width >= visible.x + visible.width &&
      previousDetail.y + previousDetail.height >= visible.y + visible.height) {
    return { preview: fallback, detail: previousDetail };
  }
  return { preview: fallback, detail };
}`;

module.exports = { PDF_RENDER_PLAN_SCRIPT };
