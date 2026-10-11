const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { buildTextImageHtml } = require('../textToImageHtml.cjs');

test('text image export wraps long words and rejects oversized canvases before allocation', async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 3 });
    await page.evaluate(() => {
      window.messages = []; window.lineWidths = []; window.maxCanvasHeight = 0;
      window.ReactNativeWebView = { postMessage: value => window.messages.push(JSON.parse(value)) };
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
        window.lineWidths.push(this.measureText(text).width);
        window.maxCanvasHeight = Math.max(window.maxCanvasHeight, this.canvas.height);
        return original.call(this, text, x, y);
      };
    });
    await page.setContent(buildTextImageHtml('short ' + 'x'.repeat(400) + '\n\u0939\u093f\u0928\u094d\u0926\u0940', { maxWidth: 400 }));
    let message = await page.evaluate(() => window.messages.at(-1));
    assert.equal(message.type, 'png');
    assert.ok(message.width * message.height <= 16000000);
    assert.ok(await page.evaluate(() => window.lineWidths.every(width => width <= 320)));
    await page.setContent(buildTextImageHtml('line\n'.repeat(1500)));
    message = await page.evaluate(() => window.messages.at(-1));
    assert.equal(message.type, 'error');
    assert.match(message.message, /too tall/i);
    await page.setContent(buildTextImageHtml('a'.repeat(20001)));
    message = await page.evaluate(() => window.messages.at(-1));
    assert.equal(message.type, 'error');
    assert.match(message.message, /too much text/i);
    assert.ok(await page.evaluate(() => window.maxCanvasHeight <= 8192));
  } finally { await browser.close(); }
});
