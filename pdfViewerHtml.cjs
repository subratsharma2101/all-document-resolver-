const { PDF_RENDER_PLAN_SCRIPT } = require('./pdfRenderPlan.cjs');

function scriptValue(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const DARK_CHROME = { bg: '#0f1115', text: '#cfd3dc', toolbar: '#191d26', toolbarBorder: '#303745', controlBorder: '#394354', controlText: '#e6e8ec', control: '#252a35', total: '#9299a8', status: '#a9aebc' };
const hex = (value, fallback) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value || '') ? value : fallback);

// Both reading and editing use the same continuous layout. Only nearby canvases
// are resident; page-size metadata and lightweight placeholders keep scrolling stable.
function buildPdfHtml(libSrc, workerSrc, base64Pdf, initialPage = 1, theme = {}, options = {}) {
  const c = {};
  for (const key of Object.keys(DARK_CHROME)) c[key] = hex(theme[key], DARK_CHROME[key]);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none';">
<style>
*{box-sizing:border-box}html,body{margin:0;background:${c.bg};color:${c.text};font:13px system-ui,sans-serif;height:100%;overflow:hidden}
body{display:flex;flex-direction:column}#toolbar{padding:6px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:${c.toolbar};border-bottom:1px solid ${c.toolbarBorder};flex-shrink:0}
button,input{font:inherit;border:1px solid ${c.controlBorder};color:${c.controlText};background:${c.control};border-radius:8px;padding:9px;min-height:40px}button:disabled{opacity:.4}input{min-width:0}#page{width:56px}#query{flex:1;width:100px}#total{color:${c.total}}#status{padding:0 12px;font-size:11px;color:${c.status};flex-shrink:0}#status:not(:empty){padding:6px 12px}
 #stage{flex:1;min-height:0;overflow:auto;padding:10px;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y pinch-zoom;overflow-anchor:none;position:relative}
 #pages{display:flex;flex-direction:column;align-items:center;gap:12px;margin:0 auto;position:relative}
 .page{position:relative;flex-shrink:0;background:#fff;box-shadow:0 2px 8px #0003;overflow:hidden;outline:none}.page canvas{position:absolute;left:0;top:0;display:block}.page-detail{z-index:1}
 .placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;color:#697180;font-size:12px;text-align:center}
 .page[data-state="ready"] .placeholder{display:none}.retry{background:#fff;color:#17498c;border-color:#bbc8dc}
 #counter{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:#202633bd;color:white;padding:6px 13px;border-radius:8px;font-size:12px;pointer-events:none;z-index:2;font-variant-numeric:tabular-nums}
 #marker{position:absolute;width:18px;height:18px;border:2px solid #397bff;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;background:#4f8eff55;display:none;z-index:2}
</style></head><body>
<div id="toolbar"><input id="page" aria-label="Go to page" type="number" min="1" value="1" disabled><span id="total">/ ...</span><button id="zoom" aria-label="Change zoom" disabled>100%</button><input id="query" aria-label="Find text in PDF" placeholder="Find text" maxlength="200" disabled><button id="find" disabled>Find</button></div>
<div id="status" role="status">Loading local PDF...</div><div id="stage" tabindex="0" aria-label="PDF pages, scroll vertically"><div id="pages"></div></div><div id="counter" aria-live="polite">...</div>
<script type="module">
const status = document.getElementById('status'), stage = document.getElementById('stage'), pagesEl = document.getElementById('pages');
const pageInput = document.getElementById('page'), findButton = document.getElementById('find');
const post = message => window.ReactNativeWebView?.postMessage(JSON.stringify(message));
const MAX_CANVASES = 5, MAX_CANVAS_PIXELS = 6000000, TOTAL_CANVAS_PIXELS = 12000000, TEXT_CACHE_CHARS = 500000;
// Half the budget holds resident pages; the other half lets a new raster finish
// before replacing the old one, without blanking the page or exceeding 12M pixels.
const RESIDENT_CANVAS_PIXELS = TOTAL_CANVAS_PIXELS - MAX_CANVAS_PIXELS;
${PDF_RENDER_PLAN_SCRIPT}
const allowMarks = ${options.allowMarks !== false};
const firstPage = ${Number.isInteger(initialPage) ? initialPage : 1};
const states = [], live = new Map(), textCache = new Map();
const marker = document.createElement('span'); marker.id = 'marker';
let pdf, loadingTask, workerUrl, active, wanted = [], pumping = false, destroyed = false;
let zoom = 1, generation = 0, currentPage = 0, frame = 0, resizeFrame = 0, layoutWidth = 0, searching = false, searchId = 0, cacheChars = 0;
function describeError(error) { return error?.name === 'PasswordException' ? 'Password-protected PDFs are not supported in this version.' : String(error?.message || error); }
function releaseCanvas(entry) {
  if (entry.canvas) { entry.canvas.width = 0; entry.canvas.height = 0; entry.canvas.remove(); }
  if (entry.detailCanvas) { entry.detailCanvas.width = 0; entry.detailCanvas.height = 0; entry.detailCanvas.remove(); }
  if (live.get(entry.state.number) === entry) {
    live.delete(entry.state.number);
    entry.state.holder.dataset.state = 'empty';
  }
  try { entry.proxy?.cleanup(); } catch { /* Cleanup must not block scrolling. */ }
}
function evict(entry) {
  entry.cancelled = true;
  if (entry.task) entry.task.cancel();
  if (active?.entry !== entry) releaseCanvas(entry);
}
// Find a page using ordered offsets: O(log n) instead of scanning every page on scroll.
function indexAt(y) {
  let lo = 0, hi = states.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (states[mid].top + states[mid].height < y) lo = mid + 1; else hi = mid; }
  return lo;
}
function anchor() {
  const index = indexAt(stage.scrollTop);
  const state = states[index];
  return { index, fraction: state.height ? (stage.scrollTop - state.top) / state.height : 0,
    x: (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, pagesEl.clientWidth) };
}
function layout(saved) {
  generation++;
  for (const entry of live.values()) evict(entry);
  layoutWidth = stage.clientWidth;
  const width = Math.max(1, Math.min(stage.clientWidth - 20, 900)) * zoom;
  pagesEl.style.width = width + 'px';
  let top = 10;
  for (const state of states) {
    state.top = top; state.width = width; state.height = width * state.viewport.height / state.viewport.width; state.failed = false;
    state.holder.style.width = width + 'px'; state.holder.style.height = state.height + 'px';
    top += state.height + 12;
  }
  if (saved) {
    const state = states[saved.index];
    stage.scrollTop = state.top + saved.fraction * state.height;
    stage.scrollLeft = saved.x * width - stage.clientWidth / 2;
  }
  schedule();
}
function reportPage(index) {
  const state = states[index];
  if (currentPage === state.number) return;
  currentPage = state.number;
  if (document.activeElement !== pageInput) pageInput.value = currentPage;
  document.getElementById('counter').textContent = currentPage + ' / ' + pdf.numPages;
  post({ type: 'page', page: currentPage, pageCount: pdf.numPages, width: state.viewport.width, height: state.viewport.height, rotation: state.viewport.rotation });
}
function updateViewport() {
  frame = 0;
  if (destroyed || !states.length) return;
  const viewport = window.visualViewport, stageRect = stage.getBoundingClientRect();
  const viewportLeft = viewport?.offsetLeft || 0, viewportTop = viewport?.offsetTop || 0;
  const left = Math.max(stageRect.left, viewportLeft), screenTop = Math.max(stageRect.top, viewportTop);
  const right = Math.min(stageRect.left + stage.clientWidth, viewportLeft + (viewport?.width || window.innerWidth));
  const screenBottom = Math.min(stageRect.top + stage.clientHeight, viewportTop + (viewport?.height || window.innerHeight));
  if (right <= left || screenBottom <= screenTop) return;
  const top = stage.scrollTop + screenTop - stageRect.top, bottom = stage.scrollTop + screenBottom - stageRect.top;
  const height = bottom - top, center = top + height * 0.35, pagesLeft = pagesEl.getBoundingClientRect().left;
  reportPage(indexAt(center));
  const first = indexAt(Math.max(0, top - height * 0.75));
  const last = indexAt(bottom + height * 0.75);
  const nearby = states.slice(first, last + 1);
  const visibleCount = nearby.filter(state => state.top < bottom && state.top + state.height > top).length;
  wanted = nearby.sort((a, b) => {
    const aVisible = a.top < bottom && a.top + a.height > top, bVisible = b.top < bottom && b.top + b.height > top;
    return Number(bVisible) - Number(aVisible) || Math.abs(a.top + a.height / 2 - center) - Math.abs(b.top + b.height / 2 - center);
  }).slice(0, Math.max(MAX_CANVASES, visibleCount));
  // Pinch zoom changes density and the visible crop, not document/tap geometry.
  const density = Math.max(1, window.devicePixelRatio || 1) * Math.max(1, viewport?.scale || 1);
  const weight = state => state.top < bottom && state.top + state.height > top ? 4 : 1;
  const totalWeight = wanted.reduce((sum, state) => sum + weight(state), 0);
  for (const state of wanted) {
    state.pixelBudget = Math.floor(RESIDENT_CANVAS_PIXELS * weight(state) / totalWeight);
    const x = Math.max(0, left - pagesLeft), y = Math.max(0, top - state.top);
    const cropWidth = Math.min(state.width, right - pagesLeft) - x, cropHeight = Math.min(state.height, bottom - state.top) - y;
    const entry = live.get(state.number);
    const previousDetail = entry?.generation === generation
      ? (active?.entry === entry && active.kind === 'detail' && !active.cancelled ? active.plan : entry.detailPlan) : null;
    state.plan = planPdfPage({ width: state.width, height: state.height, density, pixelBudget: state.pixelBudget,
      visible: cropWidth > 0 && cropHeight > 0 ? { x, y, width: cropWidth, height: cropHeight } : null, previousDetail });
  }
  const numbers = new Set(wanted.map(state => state.number));
  for (const entry of live.values()) {
    if (!numbers.has(entry.state.number) || entry.generation !== generation || entry.pixelBudget !== entry.state.pixelBudget) evict(entry);
  }
  if (active && !validJob(active)) { active.cancelled = true; active.entry.task?.cancel(); }
  pump();
}
function schedule() { if (!frame && !destroyed) frame = requestAnimationFrame(updateViewport); }
function valid(entry) { return !destroyed && !entry.cancelled && entry.generation === generation && live.get(entry.state.number) === entry; }
function validJob(job) { return valid(job.entry) && !job.cancelled && job.entry.state.plan[job.kind]?.key === job.plan.key; }
function pendingKind(state) {
  const entry = live.get(state.number);
  if (!entry || entry.previewKey !== state.plan.preview.key) return 'preview';
  if (state.plan.detail && entry.detailPlan?.key !== state.plan.detail.key) return 'detail';
  return null;
}
// Only one rasterization at a time. A cancelled getPage/render can never attach a
// stale canvas, even when the user jumps away and immediately returns to a page.
async function pump() {
  if (pumping || destroyed) return;
  pumping = true;
  try {
    while (!destroyed) {
      const state = wanted.find(item => !item.failed && pendingKind(item));
      if (!state) break;
      let entry = live.get(state.number);
      if (!entry) {
        entry = { state, generation, pixelBudget: state.pixelBudget, cancelled: false };
        live.set(state.number, entry); state.holder.dataset.state = 'rendering';
      }
      const kind = pendingKind(state), plan = state.plan[kind];
      const job = { entry, kind, plan, cancelled: false, attached: false }; active = job;
      try {
        if (!entry.proxy) entry.proxy = await pdf.getPage(state.number);
        if (!validJob(job)) continue;
        const scaled = entry.proxy.getViewport({ scale: state.width / state.viewport.width });
        const canvas = document.createElement('canvas'); job.canvas = canvas;
        canvas.className = kind === 'detail' ? 'page-detail' : 'page-preview';
        canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
        canvas.style.left = plan.x + 'px'; canvas.style.top = plan.y + 'px';
        canvas.style.width = canvas.width / plan.density + 'px'; canvas.style.height = canvas.height / plan.density + 'px';
        entry.task = entry.proxy.render({ canvasContext: canvas.getContext('2d'), viewport: scaled,
          transform: [plan.density, 0, 0, plan.density, -plan.x * plan.density, -plan.y * plan.density] });
        await entry.task.promise; entry.task = null;
        if (!validJob(job)) continue;
        const oldCanvas = kind === 'detail' ? entry.detailCanvas : entry.canvas;
        if (oldCanvas) { oldCanvas.width = 0; oldCanvas.height = 0; oldCanvas.remove(); }
        if (kind === 'detail') { entry.detailCanvas = canvas; entry.detailPlan = plan; }
        else { entry.canvas = canvas; entry.previewKey = plan.key; }
        if (!state.plan.detail && entry.detailCanvas) {
          entry.detailCanvas.width = 0; entry.detailCanvas.height = 0; entry.detailCanvas.remove(); entry.detailCanvas = null; entry.detailPlan = null;
        }
        state.holder.appendChild(canvas); job.attached = true; state.holder.dataset.state = 'ready';
      } catch (error) {
        if (validJob(job) && error?.name !== 'RenderingCancelledException') {
          state.failed = true;
          releaseCanvas(entry);
          state.placeholder.textContent = 'Page ' + state.number + ': ' + describeError(error);
          const retry = document.createElement('button'); retry.className = 'retry'; retry.textContent = 'Retry page';
          retry.onclick = event => { event.stopPropagation(); state.failed = false; state.placeholder.textContent = 'Page ' + state.number; schedule(); };
          state.placeholder.appendChild(retry);
        }
      } finally {
        if (!job.attached && job.canvas) { job.canvas.width = 0; job.canvas.height = 0; job.canvas.remove(); }
        if (!valid(entry)) releaseCanvas(entry);
        entry.task = null;
        if (active === job) active = null;
      }
    }
  } finally { pumping = false; }
}
function goToPage(number) {
  if (!Number.isInteger(number) || number < 1 || number > states.length) { pageInput.value = currentPage; return; }
  stage.scrollTop = states[number - 1].top;
  reportPage(number - 1); schedule();
}
async function pageText(number) {
  if (textCache.has(number)) { const text = textCache.get(number); textCache.delete(number); textCache.set(number, text); return text; }
  const page = await pdf.getPage(number);
  const content = await page.getTextContent();
  const text = content.items.map(item => item.str || '').join(' ').toLowerCase();
  if (!live.has(number)) page.cleanup();
  if (text.length <= TEXT_CACHE_CHARS) {
    while (textCache.size && cacheChars + text.length > TEXT_CACHE_CHARS) { const key = textCache.keys().next().value; cacheChars -= textCache.get(key).length; textCache.delete(key); }
    textCache.set(number, text); cacheChars += text.length;
  }
  return text;
}
let lastQuery = '', lastMatch = 0;
async function findText() {
  if (searching) { searchId++; searching = false; findButton.textContent = 'Find'; status.textContent = 'Search cancelled.'; return; }
  const query = document.getElementById('query').value.trim().toLowerCase(); if (!query) return;
  const id = ++searchId, start = query === lastQuery ? lastMatch % pdf.numPages : Math.max(0, currentPage - 1);
  searching = true; findButton.textContent = 'Cancel';
  try {
    for (let offset = 0; offset < pdf.numPages; offset++) {
      const n = (start + offset) % pdf.numPages + 1;
      status.textContent = 'Searching page ' + n + '...';
      const text = await pageText(n);
      if (destroyed || id !== searchId) return;
      if (text.includes(query)) {
        lastQuery = query; lastMatch = n; goToPage(n);
        status.textContent = 'Text found on page ' + n + '. Find again for the next page.'; return;
      }
    }
    status.textContent = 'No matching text. Scanned PDFs need OCR, which is not included.';
  } catch (error) { if (!destroyed && id === searchId) status.textContent = describeError(error); }
  finally { if (id === searchId) { searching = false; findButton.textContent = 'Find'; } }
}
stage.addEventListener('scroll', schedule, { passive: true });
window.visualViewport?.addEventListener('resize', schedule, { passive: true });
window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
let pointerStart;
pagesEl.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; });
pagesEl.addEventListener('pointercancel', () => { pointerStart = null; });
pagesEl.addEventListener('click', event => {
  if (!allowMarks || !pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) return;
  pointerStart = null;
  const holder = event.target.closest('.page'); if (!holder || holder.dataset.state !== 'ready') return;
  const rect = holder.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  holder.appendChild(marker); marker.style.left = (x * 100) + '%'; marker.style.top = (y * 100) + '%'; marker.style.display = 'block';
  post({ page: Number(holder.dataset.page), type: 'tap', x, y });
});
window.addEventListener('resize', () => {
  if (!states.length || destroyed) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (stage.clientWidth !== layoutWidth) layout(anchor()); else schedule(); });
});
function shutdown() {
  destroyed = true; searchId++; cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame);
  for (const entry of live.values()) evict(entry);
  textCache.clear();
  loadingTask?.destroy().catch(() => {});
  if (workerUrl) URL.revokeObjectURL(workerUrl);
}
window.addEventListener('pagehide', shutdown, { once: true });
try {
  if (!Promise.withResolvers) Promise.withResolvers = function() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const libUrl = URL.createObjectURL(new Blob([${scriptValue(libSrc)}], { type: 'text/javascript' }));
  let pdfjs;
  try { pdfjs = await import(libUrl); } finally { URL.revokeObjectURL(libUrl); }
  workerUrl = URL.createObjectURL(new Blob([${scriptValue(workerSrc)}], { type: 'text/javascript' })); pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let raw = atob(${scriptValue(base64Pdf)}); const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); raw = null;
  loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported:false, enableXfa:false, useSystemFonts:true, maxImageSize:16000000, canvasMaxAreaInBytes:16000000 });
  pdf = await loadingTask.promise;
  if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('This PDF has no readable pages.');
  // Only metadata is read here, not page pixels. Exact sizes prevent layout jumps
  // when a landscape/cropped page first enters the viewport later in the document.
  for (let start = 1; start <= pdf.numPages; start += 8) {
    if (destroyed) break;
    status.textContent = 'Preparing page layout ' + start + ' / ' + pdf.numPages + '...';
    const batch = await Promise.all(Array.from({ length: Math.min(8, pdf.numPages - start + 1) }, (_, i) => pdf.getPage(start + i)));
    for (const page of batch) {
      const viewport = page.getViewport({ scale: 1 });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0 || viewport.height / viewport.width > 100) throw new Error('Unsupported PDF page dimensions.');
      const holder = document.createElement('section'), placeholder = document.createElement('div');
      const number = states.length + 1; holder.className = 'page'; holder.dataset.page = number; holder.dataset.state = 'empty'; holder.setAttribute('aria-label', 'Page ' + number);
      placeholder.className = 'placeholder'; placeholder.textContent = 'Page ' + number; holder.appendChild(placeholder); pagesEl.appendChild(holder);
      states.push({ number, holder, placeholder, viewport });
    }
  }
  if (!destroyed) {
    window.fileViewerGoToPage = number => { if (Number.isInteger(number) && number > 0 && number <= pdf.numPages) goToPage(number); };
    layout(); goToPage(Math.max(1, Math.min(pdf.numPages, firstPage)));
    pageInput.max = pdf.numPages; document.getElementById('total').textContent = '/ ' + pdf.numPages;
    document.querySelectorAll('#toolbar button,#toolbar input').forEach(el => { el.disabled = false; });
    pageInput.onchange = event => goToPage(Number(event.target.value));
    pageInput.onkeydown = event => { if (event.key === 'Enter') { goToPage(Number(pageInput.value)); pageInput.blur(); } };
    document.getElementById('zoom').onclick = event => { const saved = anchor(); zoom = zoom >= 3 ? 1 : zoom + 0.5; event.target.textContent = Math.round(zoom * 100) + '%'; layout(saved); };
    findButton.onclick = findText;
    document.getElementById('query').onkeydown = event => { if (event.key === 'Enter') findText(); };
    status.textContent = '';
  }
} catch (error) {
  if (!destroyed) { status.textContent = describeError(error); post({ type: 'error', message: describeError(error) }); }
}
</script></body></html>`;
}

module.exports = { buildPdfHtml, scriptValue };
