const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfHtml, scriptValue } = require('../pdfViewerHtml.cjs');

test('bundled scripts cannot prematurely close the HTML script element', () => {
  const source = 'const x = "</script><script>alert(1)</script>";';
  assert.equal(JSON.parse(scriptValue(source)), source);
  assert.ok(!scriptValue(source).includes('<'));
  const html = buildPdfHtml(source, source, 'JVBERg==');
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
});
test('PDF runtime is offline and disables eval in document processing', () => {
  const html = buildPdfHtml('', '', '', 3);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /isEvalSupported:false/);
  assert.match(html, /const firstPage = 3/);
  assert.match(html, /entry.canvas.width = 0; entry.canvas.height = 0/);
});
test('all viewing modes use bounded continuous scrolling with no page replacement buttons', () => {
  const html = buildPdfHtml('', '', 'JVBERg==', 1, {}, { allowMarks: false });
  assert.match(html, /MAX_CANVASES = 5/);
  assert.match(html, /const allowMarks = false/);
  assert.match(html, /function indexAt/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /isEvalSupported:false/);
  assert.doesNotMatch(html, /id="prev"/);
  assert.doesNotMatch(html, /id="next"/);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
});
test('theme CSS values cannot escape the style element', () => {
  const html = buildPdfHtml('', '', '', 1, { bg: '</style><script>bad()</script>', control: '#eef1f7' });
  assert.doesNotMatch(html, /bad\(\)/);
  assert.match(html, /#eef1f7/);
});
