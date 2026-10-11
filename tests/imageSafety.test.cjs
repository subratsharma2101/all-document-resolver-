const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectImageHeader, boundedDimensions, WORKING_IMAGE_EDGE } = require('../imageSafety.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
test('metadata is read without decoding pixels and excessive dimensions are rejected', () => {
  assert.deepEqual(inspectImageHeader(PNG), { width: 1, height: 1, type: 'png' });
  const large = Buffer.from(PNG);
  large.writeUInt32BE(12000, 16); large.writeUInt32BE(12000, 20);
  assert.throws(() => inspectImageHeader(large), /large|megapixel/i);
  assert.throws(() => inspectImageHeader(Buffer.from('not an image')), /header/);
});
test('animations and unvalidated PNG metadata fail before native loading', () => {
  const animated = Buffer.from(PNG); animated.write('acTL', 37, 'ascii');
  assert.throws(() => inspectImageHeader(animated), /Animated/);
  assert.throws(() => inspectImageHeader(PNG.subarray(0, 33)), /metadata/);
  const gif = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
  assert.throws(() => inspectImageHeader(gif), /static/);
});
test('working dimensions are bounded without upscaling or changing aspect ratio', () => {
  assert.deepEqual(boundedDimensions(8000, 6000), { width: 3072, height: 2304 });
  assert.deepEqual(boundedDimensions(320, 160), { width: 320, height: 160 });
  assert.ok(boundedDimensions(6000, 8000).height <= WORKING_IMAGE_EDGE);
  assert.throws(() => boundedDimensions(800, 600, Infinity), /limit/);
});

module.exports = { PNG };
