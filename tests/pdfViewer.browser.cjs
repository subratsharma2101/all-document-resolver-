const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { buildPdfHtml } = require('../pdfViewerHtml.cjs');

test('offline PDF preview renders, navigates, searches, zooms and reports tap coordinates', async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 650 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const [lib, worker] = await Promise.all(['pdf.lib.txt', 'pdf.worker.txt'].map(name => fs.readFile(path.join(__dirname, '../assets/pdfjs', name), 'utf8')));
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    ['First local page', 'Needle on second page', 'Final local page'].forEach(text => {
      pdf.addPage([400, 500]).drawText(text, { x: 30, y: 440, size: 18, font });
    });
    await page.evaluate(() => {
      window.messages = [];
      window.ReactNativeWebView = { postMessage: message => window.messages.push(JSON.parse(message)) };
    });
    await page.setContent(buildPdfHtml(lib, worker, Buffer.from(await pdf.save()).toString('base64')));
    await page.waitForFunction(() => window.messages.some(message => message.type === 'page' || message.type === 'error'));
    assert.deepEqual(await page.evaluate(() => window.messages.filter(message => message.type === 'error')), []);
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal(await page.locator('#page').inputValue(), '1');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#page').value === '2' && !document.querySelector('#next').disabled);
    await page.locator('#prev').click();
    await page.waitForFunction(() => document.querySelector('#page').value === '1' && !document.querySelector('#next').disabled);
    await page.locator('#query').fill('needle');
    await page.locator('#find').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Text found on page 2'));
    await page.locator('#zoom').click();
    await page.waitForFunction(() => document.querySelector('#zoom').textContent === '150%' && !document.querySelector('#zoom').disabled);
    await page.locator('canvas').click({ position: { x: 70, y: 80 } });
    const tap = await page.evaluate(() => window.messages.findLast(message => message.type === 'tap'));
    assert.equal(tap.page, 2);
    assert.ok(tap.x > 0 && tap.x < 1 && tap.y > 0 && tap.y < 1);
    await page.locator('#page').fill('3');
    await page.locator('#page').press('Tab');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Page 3 of'));
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('canvas').count(), 1);
    await page.locator('#query').fill('missing-word');
    await page.locator('#find').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('No matching text'));
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
