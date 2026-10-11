const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const { buildPdfHtml } = require('../pdfViewerHtml.cjs');

async function fixture(count = 30) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) {
    const page = pdf.addPage(i % 3 === 0 ? [700, 300] : [400, 550]);
    page.drawText(i === 17 ? 'Needle here' : `Local page ${i}`, { x: 30, y: 240, size: 18, font });
    if (i === 12) page.setRotation(degrees(90));
  }
  return Buffer.from(await pdf.save()).toString('base64');
}
async function withBrowser(run) {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try { await run(await browser.newPage({ viewport: { width: 390, height: 650 }, deviceScaleFactor: 3 })); }
  finally { await browser.close(); }
}
async function open(page, { count = 30, initial = 1, allowMarks = true, lib: customLib } = {}) {
  const [lib, worker] = await Promise.all(['pdf.lib.txt', 'pdf.worker.txt'].map(name => fs.readFile(path.join(__dirname, '../assets/pdfjs', name), 'utf8')));
  await page.evaluate(() => {
    window.messages = [];
    window.ReactNativeWebView = { postMessage: message => window.messages.push(JSON.parse(message)) };
  });
  await page.setContent(buildPdfHtml(customLib || lib, worker, await fixture(count), initial, {}, { allowMarks }));
  await page.waitForFunction(() => !document.querySelector('#page').disabled || window.messages.some(message => message.type === 'error'));
  assert.deepEqual(await page.evaluate(() => window.messages.filter(message => message.type === 'error')), []);
}
async function jump(page, number) {
  await page.locator('#page').fill(String(number));
  await page.locator('#page').press('Enter');
  await page.waitForFunction(n => document.querySelector('.page[data-page="' + n + '"]').dataset.state === 'ready', number);
}

test('continuous PDF scroll keeps all placeholders, bounded sharp canvases, search and correct annotation targets', async () => withBrowser(async page => {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await open(page);
  assert.equal(await page.locator('.page').count(), 30);
  assert.equal(await page.locator('#next').count(), 0);
  await page.waitForSelector('.page[data-page="1"][data-state="ready"]');
  const beforeHeight = await page.locator('#pages').evaluate(el => el.offsetHeight);
  await page.locator('#stage').hover();
  await page.mouse.wheel(0, 550);
  await page.waitForFunction(() => document.querySelector('#stage').scrollTop > 100);
  await jump(page, 17);
  assert.ok(await page.locator('canvas.page-preview').count() <= 5);
  assert.equal(await page.locator('.page[data-page="1"] canvas').count(), 0);
  assert.equal(await page.locator('#pages').evaluate(el => el.offsetHeight), beforeHeight);
  await page.locator('.page[data-page="17"] canvas').click({ position: { x: 70, y: 80 } });
  const tap = await page.evaluate(() => window.messages.findLast(message => message.type === 'tap'));
  assert.equal(tap.page, 17);
  assert.ok(tap.x > 0 && tap.x < 1 && tap.y > 0 && tap.y < 1);
  await jump(page, 1);
  await page.locator('#query').fill('needle');
  await page.locator('#find').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Text found on page 17'));
  await page.locator('#zoom').click();
  await page.waitForSelector('.page[data-page="17"][data-state="ready"]');
  assert.equal(await page.locator('#zoom').textContent(), '150%');
  const pixels = await page.locator('canvas').evaluateAll(canvases => canvases.map(c => c.width * c.height));
  assert.ok(pixels.every(value => value <= 6000000));
  assert.ok(pixels.reduce((sum, value) => sum + value, 0) <= 12000000);
  await page.setViewportSize({ width: 800, height: 500 });
  await page.waitForFunction(() => parseInt(document.querySelector('.page').style.width) > 800);
  await jump(page, 30);
  await jump(page, 1);
  assert.equal(await page.locator('.page').count(), 30);
  assert.ok(await page.locator('canvas.page-preview').count() <= 5);
  await page.locator('#query').fill('missing-word');
  await page.locator('#find').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('No matching text'));
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
}));

test('initial page and read-only mode work, with layout stable across mixed page sizes', async () => withBrowser(async page => {
  await open(page, { initial: 17, allowMarks: false });
  await page.waitForSelector('.page[data-page="17"][data-state="ready"]');
  assert.equal(await page.locator('#counter').textContent(), '17 / 30');
  await page.locator('.page[data-page="17"] canvas').click({ position: { x: 40, y: 40 } });
  assert.equal(await page.evaluate(() => window.messages.some(message => message.type === 'tap')), false);
  const tall = await page.locator('.page[data-page="1"]').evaluate(el => el.offsetHeight);
  const wide = await page.locator('.page[data-page="3"]').evaluate(el => el.offsetHeight);
  assert.ok(tall > wide * 2);
}));

const delayedPdf = `export const GlobalWorkerOptions = {};
export function getDocument() {
 const counts=new Map(); window.activeRenders=0; window.maxActive=0; window.cancelledRenders=0;
 return { destroy:async()=>{}, promise:Promise.resolve({numPages:40,getPage:async n=>{
  const count=(counts.get(n)||0)+1; counts.set(n,count);
  if(count>1) await new Promise(resolve=>setTimeout(resolve,45));
  return {getViewport:({scale})=>({width:400*scale,height:550*scale,rotation:0}),cleanup:()=>{},
   getTextContent:async()=>({items:[{str:'page '+n}]}),render:({canvasContext})=>{
    window.activeRenders++;window.maxActive=Math.max(window.maxActive,window.activeRenders);
    let rejectTask,timer,finished=false;
    const done=()=>{if(!finished){finished=true;window.activeRenders--;}};
    const promise=new Promise((resolve,reject)=>{rejectTask=reject;timer=setTimeout(()=>{canvasContext.fillRect(0,0,40,40);done();resolve()},70)});
    return {promise,cancel:()=>{if(!finished){clearTimeout(timer);done();window.cancelledRenders++;rejectTask(Object.assign(new Error('cancelled'),{name:'RenderingCancelledException'}))}}};
   }};
 }})};
}`;
test('rapid jumps during delayed rendering cannot attach stale canvases or overlap raster jobs', async () => withBrowser(async page => {
  await open(page, { lib: delayedPdf });
  for (const n of [25, 2, 38, 8, 30, 1, 18]) {
    await page.locator('#page').fill(String(n));
    await page.locator('#page').press('Enter');
  }
  await jump(page, 18);
  await page.waitForFunction(() => window.activeRenders === 0);
  assert.equal(await page.evaluate(() => window.maxActive), 1);
  assert.ok(await page.locator('canvas.page-preview').count() <= 5);
  assert.equal(await page.locator('.page[data-page="1"] canvas').count(), 0);
  assert.equal(await page.locator('.page[data-page="18"] canvas.page-preview').count(), 1);
  await page.locator('#zoom').click();
  await page.locator('#zoom').click();
  await jump(page, 18);
  assert.equal(await page.locator('.page[data-page="18"] canvas.page-preview').count(), 1);
}));

test('read-only mode includes every page, including documents over 1000 pages', async () => withBrowser(async page => {
  await open(page, { count: 1001, initial: 1001, allowMarks: false });
  await page.waitForSelector('.page[data-page="1001"][data-state="ready"]');
  assert.equal(await page.locator('.page').count(), 1001);
  assert.match(await page.locator('#counter').textContent(), /1001/);
  await jump(page, 1);
  assert.equal(await page.locator('.page').count(), 1001);
}));

test('every page visible on screen renders even when more than five short pages fit', async () => withBrowser(async page => {
  await open(page, { lib: delayedPdf.replace('height:550*scale', 'height:20*scale'), allowMarks: false });
  await page.waitForFunction(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const visible = [...document.querySelectorAll('.page')].filter(el => { const r = el.getBoundingClientRect(); return r.top < stage.bottom && r.bottom > stage.top; });
    return visible.length > 5 && visible.every(el => el.dataset.state === 'ready');
  });
  const pixels = await page.locator('canvas').evaluateAll(canvases => canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0));
  assert.ok(pixels <= 12000000);
}));

test('pinch zoom re-rasterizes existing PDFs at higher detail within the total canvas budget', async () => withBrowser(async page => {
  await page.evaluate(() => {
    window.testPinchScale = 1; window.testPinchLeft = 0; window.testPinchTop = 0;
    Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => window.testPinchScale });
    Object.defineProperty(window.visualViewport, 'width', { configurable: true, get: () => window.innerWidth / window.testPinchScale });
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight / window.testPinchScale });
    Object.defineProperty(window.visualViewport, 'offsetLeft', { configurable: true, get: () => window.testPinchLeft });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, get: () => window.testPinchTop });
  });
  await open(page, { allowMarks: false });
  await page.waitForSelector('.page[data-page="1"][data-state="ready"] canvas');
  const before = await page.locator('.page[data-page="1"] canvas').evaluate(c => ({ density: c.width / parseFloat(c.style.width), cssWidth: c.parentElement.style.width }));
  await page.evaluate(() => { window.testPinchScale = 2; window.visualViewport.dispatchEvent(new Event('resize')); });
  await page.waitForFunction(() => {
    const c = document.querySelector('.page[data-page="1"] canvas.page-detail');
    return c && c.width / parseFloat(c.style.width) >= 6 - 0.01;
  });
  const after = await page.locator('.page[data-page="1"] canvas.page-detail').evaluate(c => ({ density: c.width / parseFloat(c.style.width), cssWidth: c.parentElement.style.width }));
  assert.ok(after.density > before.density * 1.5, 'pinch should increase real raster resolution');
  assert.equal(after.cssWidth, before.cssWidth, 'pinch must not change document geometry');
  await page.evaluate(() => {
    window.testPinchScale = 5; window.testPinchLeft = 130; window.testPinchTop = 150;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('.page[data-page="1"] canvas.page-detail');
    return c && c.width / parseFloat(c.style.width) >= 15 - 0.01;
  });
  const firstCrop = await page.locator('.page[data-page="1"] canvas.page-detail').evaluate(c => ({ x: parseFloat(c.style.left), y: parseFloat(c.style.top) }));
  await page.evaluate(() => {
    window.testPinchLeft = 210; window.testPinchTop = 300;
    window.visualViewport.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(previous => {
    const c = document.querySelector('.page[data-page="1"] canvas.page-detail');
    return c && parseFloat(c.style.left) > previous.x && parseFloat(c.style.top) > previous.y;
  }, firstCrop);
  const pixels = await page.locator('canvas').evaluateAll(cs => cs.map(c => c.width * c.height));
  assert.ok(pixels.every(n => n <= 6000000));
  assert.ok(pixels.reduce((sum, n) => sum + n, 0) <= 12000000);
  await page.evaluate(() => {
    window.testPinchScale = 1; window.testPinchLeft = 0; window.testPinchTop = 0;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await jump(page, 30);
  await jump(page, 1);
}));

test('300% toolbar zoom keeps visible PDF text at screen density while panning', async () => withBrowser(async page => {
  await open(page, { count: 1 });
  for (let i = 0; i < 4; i++) await page.locator('#zoom').click();
  await page.waitForSelector('.page[data-page="1"] canvas.page-detail');
  const detail = await page.locator('canvas.page-detail').evaluate(c => ({
    density: c.width / parseFloat(c.style.width), width: parseFloat(c.style.width), pageWidth: c.parentElement.offsetWidth,
  }));
  assert.ok(detail.density >= 3 - 0.01, 'zoomed text must retain native screen resolution');
  assert.ok(detail.width < detail.pageWidth, 'only the visible region needs a large raster');
  await page.locator('#stage').evaluate(el => { el.scrollLeft += 230; el.scrollTop = 420; });
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas.page-detail');
    const stage = document.querySelector('#stage').getBoundingClientRect(), crop = c?.getBoundingClientRect();
    return crop && crop.left <= stage.left && crop.right >= stage.right && crop.top <= stage.top && crop.bottom >= stage.bottom;
  });
  await page.locator('canvas.page-detail').click({ position: { x: 100, y: 100 } });
  const tap = await page.evaluate(() => window.messages.findLast(message => message.type === 'tap'));
  assert.equal(tap.page, 1);
  assert.ok(tap.x > 0 && tap.x < 1 && tap.y > 0 && tap.y < 1);
  const pixels = await page.locator('canvas').evaluateAll(cs => cs.reduce((sum, c) => sum + c.width * c.height, 0));
  assert.ok(pixels <= 12000000);
}));
