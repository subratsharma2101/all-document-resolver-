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
  assert.match(html, /Math.min\(pdf.numPages,3\)/);
  assert.match(html, /old.width=0;old.height=0/);
});
