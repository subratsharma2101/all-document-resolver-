const test = require('node:test');
const assert = require('node:assert/strict');
const xcode = require('xcode');

test('the security override preserves the xcode UUID v4 integration', () => {
  const project = xcode.project('not-written.pbxproj');
  project.hash = { project: { objects: {} } };
  const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9A-F]{24}$/);
});
