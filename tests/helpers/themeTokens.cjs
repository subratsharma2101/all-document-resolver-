const path = require('node:path');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');

// Load the real spacing/radius/type tokens out of theme.js without pulling in React or
// the native modules, so UI tests style themselves exactly like the running app.
function loadThemeModule(reactNative = { Platform: { OS: 'android' }, StyleSheet: { hairlineWidth: 1 } }, fileSystem) {
  const { code } = transformFileSync(path.join(process.cwd(), 'theme.js'), {
    configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'],
  });
  const module = { exports: {} };
  const context = vm.createContext({ exports: module.exports, module, require: name => {
    if (name === 'react') return { createContext: () => ({}), useContext: () => ({}), useEffect() {}, useMemo: factory => factory(), useRef: () => ({}), useState: () => [null, () => {}] };
    if (name === 'react-native') return reactNative;
    if (name === 'expo-system-ui') return { setBackgroundColorAsync: async () => {} };
    if (name === 'expo-file-system') return fileSystem || { File: class { get exists() { return false; } }, Paths: { document: 'file:///documents' } };
    throw new Error(`Unexpected module ${name}`);
  } });
  vm.runInContext(`${code}\nmodule.exports = { ...module.exports, loadSavedMode, saveMode };`, context);
  return module.exports;
}

const tokens = loadThemeModule();

module.exports = {
  loadThemeModule,
  space: tokens.space,
  radius: tokens.radius,
  type: tokens.type,
  hairline: tokens.hairline,
  THEMES: tokens.THEMES,
};
