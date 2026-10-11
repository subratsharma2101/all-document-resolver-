const test = require('node:test');
const assert = require('node:assert/strict');
const { loadThemeModule, space, radius, type, hairline } = require('./helpers/themeTokens.cjs');

test('native press feedback uses a ripple on Android and opacity elsewhere', () => {
  const android = loadThemeModule({ Platform: { OS: 'android' }, StyleSheet: { hairlineWidth: 1 } });
  // The helper builds its object inside the VM realm, so compare fields, not prototypes.
  assert.deepEqual({ ...android.rippleFor('#fff') }, { color: '#fff', borderless: false, foreground: true });
  assert.equal(android.pressedOpacity(true, false), 1, 'the ripple already shows the press on Android');
  assert.equal(android.pressedOpacity(false, true), 0.4);
  const ios = loadThemeModule({ Platform: { OS: 'ios' }, StyleSheet: { hairlineWidth: 0.5 } });
  assert.equal(ios.rippleFor('#fff'), undefined);
  assert.equal(ios.pressedOpacity(true, false), 0.6);
  assert.equal(ios.pressedOpacity(false, false), 1);
});

test('theme settings restore synchronously and preserve other saved preferences', () => {
  let saved = JSON.stringify({ theme: 'light', otherSetting: 'keep' });
  class File {
    get exists() { return saved !== null; }
    text() { throw new Error('Async file text must not be JSON-parsed synchronously'); }
    textSync() { return saved; }
    write(value) { saved = value; }
  }
  const settings = loadThemeModule({ Platform: { OS: 'android' }, StyleSheet: { hairlineWidth: 1 } }, { File, Paths: { document: 'file:///documents' } });
  assert.equal(settings.loadSavedMode(), 'light');
  settings.saveMode('dark');
  assert.deepEqual(JSON.parse(saved), { theme: 'dark', otherSetting: 'keep' });
  assert.equal(settings.loadSavedMode(), 'dark');
  saved = '{invalid';
  assert.equal(settings.loadSavedMode(), null);
});

test('design tokens form one consistent scale for every screen', () => {
  assert.deepEqual(Object.keys(space), ['xs', 'sm', 'md', 'lg', 'xl', 'xxl']);
  const steps = Object.values(space);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), 'spacing increases');
  assert.ok(steps.every(value => Number.isInteger(value) && value % 4 === 0), 'spacing uses a 4pt grid');
  assert.ok(Object.values(radius).every(value => Number.isInteger(value) && value > 0));
  assert.ok(radius.pill >= 999, 'a pill radius is available for chips');
  assert.equal(typeof hairline, 'number');
  for (const [name, style] of Object.entries(type)) {
    assert.ok(style.fontSize >= 12, `${name} stays legible`);
    assert.ok(style.lineHeight > style.fontSize, `${name} has breathing room`);
  }
  assert.ok(type.display.fontSize > type.title.fontSize);
  assert.ok(type.title.fontSize > type.heading.fontSize);
});

test('both palettes expose every semantic color the screens use', () => {
  const { THEMES } = require('./helpers/themeTokens.cjs');
  const required = ['bg', 'surface', 'surfaceAlt', 'border', 'text', 'textMuted', 'textFaint', 'primary',
    'primaryText', 'onPrimarySurface', 'chip', 'chipText', 'chipOn', 'chipTextOn', 'danger', 'dangerBg',
    'success', 'warn', 'overlayViewer', 'scrim', 'ripple', 'skeleton', 'statusBar', 'accents'];
  for (const mode of ['light', 'dark']) {
    for (const key of required) assert.ok(THEMES[mode][key], `${mode}.${key} is defined`);
    for (const kind of ['pdf', 'image', 'text', 'signature']) {
      assert.match(THEMES[mode].accents[kind], /^#[0-9a-f]{6}$/i, `${mode} accent ${kind}`);
    }
    // Removed decorative tokens must not come back without a design reason.
    for (const gone of ['hero', 'heroText', 'heroMuted', 'mint']) {
      assert.equal(THEMES[mode][gone], undefined, `${mode}.${gone} was retired`);
    }
  }
  assert.notEqual(THEMES.light.bg, THEMES.dark.bg);
});
