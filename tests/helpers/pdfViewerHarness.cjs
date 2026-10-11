const vm = require('node:vm');
const { buildPdfHtml } = require('../../pdfViewerHtml.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('PDF runtime did not settle');
    await pause(5);
  }
}

// A small DOM/PDF.js test double for running the actual generated viewer script.
// Tracks detached raster allocations too, which DOM-only canvas counts miss.
async function viewer({ count = 30, pageHeight = 550, delay = 10, initialPage = 1 } = {}) {
  const allCanvases = [], messages = [], jobs = [], timers = new Set();
  const metrics = { active: 0, peakActive: 0, peakPixels: 0 };
  function measure() {
    metrics.peakPixels = Math.max(metrics.peakPixels, allCanvases.reduce((sum, c) => sum + c.width * c.height, 0));
  }
  class Element {
    constructor(tag, id = '') {
      this.tagName = tag; this.id = id; this.children = []; this.style = {}; this.dataset = {};
      this.listeners = new Map(); this._width = 0; this._height = 0; this._top = 0; this._left = 0;
      this.disabled = true; this.value = ''; this.textContent = '';
    }
    get width() { return this._width; }
    set width(value) { this._width = value; measure(); }
    get height() { return this._height; }
    set height(value) { this._height = value; measure(); }
    get scrollTop() { return this._top; }
    set scrollTop(value) { this._top = Math.max(0, value); this.dispatchEvent({ type: 'scroll' }); }
    get scrollLeft() { return this._left; }
    set scrollLeft(value) { this._left = Math.max(0, value); this.dispatchEvent({ type: 'scroll' }); }
    get clientWidth() { return this.id === 'stage' ? 390 : parseFloat(this.style.width) || 0; }
    get clientHeight() { return this.id === 'stage' ? 596 : parseFloat(this.style.height) || 0; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    setAttribute() {}
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
    getContext() { return { canvas: this }; }
    blur() {}
    closest() { return this.className === 'page' ? this : this.parentElement?.closest(); }
    getBoundingClientRect() {
      let left = 0, top = 54, width = this.clientWidth, height = this.clientHeight;
      if (this.id === 'pages') { left = 10 - elements.stage.scrollLeft; top += 10 - elements.stage.scrollTop; }
      else if (this.parentElement) {
        const parent = this.parentElement.getBoundingClientRect();
        left = parent.left + (parseFloat(this.style.left) || 0); top = parent.top + (parseFloat(this.style.top) || 0);
        if (this.className === 'page') {
          for (const sibling of this.parentElement.children) { if (sibling === this) break; top += sibling.clientHeight + 12; }
        }
      }
      return { left, top, right: left + width, bottom: top + height, width, height };
    }
  }
  const elements = Object.fromEntries(['stage', 'pages', 'status', 'page', 'find', 'zoom', 'query', 'counter', 'total']
    .map(id => [id, new Element('div', id)]));
  const window = new Element('window');
  window.innerWidth = 390; window.innerHeight = 650; window.devicePixelRatio = 3;
  window.visualViewport = Object.assign(new Element('viewport'), { scale: 1, width: 390, height: 650, offsetLeft: 0, offsetTop: 0 });
  window.ReactNativeWebView = { postMessage: text => messages.push(JSON.parse(text)) };
  const document = {
    getElementById: id => elements[id],
    createElement: tag => { const element = new Element(tag); if (tag === 'canvas') allCanvases.push(element); return element; },
    querySelectorAll: () => [elements.page, elements.find, elements.zoom, elements.query],
  };
  function later(callback, ms) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms); timers.add(timer); return timer;
  }
  const pdf = { numPages: count, getPage: async number => ({
    getViewport: ({ scale }) => ({ width: 400 * scale, height: pageHeight * scale, rotation: 0 }),
    cleanup() {},
    getTextContent: async () => ({ items: [{ str: `Page ${number}` }] }),
    render(parameters) {
      const job = { number, ...parameters }; jobs.push(job);
      metrics.active++; metrics.peakActive = Math.max(metrics.peakActive, metrics.active);
      let finished = false, reject;
      const finish = () => { if (finished) return false; finished = true; metrics.active--; return true; };
      const promise = new Promise((resolve, fail) => {
        reject = fail; later(() => { if (finish()) resolve(); }, delay);
      });
      return { promise, cancel() { if (finish()) reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })); } };
    },
  }) };
  window.testPdfjs = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => {} }) };
  const context = vm.createContext({ window, document, console, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    requestAnimationFrame: callback => later(callback, 1),
    cancelAnimationFrame: timer => { clearTimeout(timer); timers.delete(timer); },
  });
  const script = buildPdfHtml('', '', '', initialPage).match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace('await import(libUrl)', 'window.testPdfjs');
  await vm.runInContext(`(async () => { ${script} })()`, context);
  const holder = number => elements.pages.children[number - 1];
  const canvas = (number, kind) => holder(number).children.find(el => el.className === `page-${kind}`);
  return { elements, window, messages, jobs, metrics, holder, canvas,
    zoom() { elements.zoom.onclick({ target: elements.zoom }); },
    jump(number) { elements.page.onchange({ target: { value: String(number) } }); },
    pinch(scale, x = 0, y = 0, event = 'resize') {
      Object.assign(window.visualViewport, { scale, width: 390 / scale, height: 650 / scale, offsetLeft: x, offsetTop: y });
      window.visualViewport.dispatchEvent({ type: event });
    },
    close() { window.dispatchEvent({ type: 'pagehide' }); for (const timer of timers) clearTimeout(timer); },
  };
}

module.exports = { viewer, until, pause };
