const vm = require('node:vm');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');
const code = transformFileSync(path.join(__dirname, '../../storedJson.js'), { configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
module.exports = function storedJsonHarness(File) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'expo-file-system') return { File };
    throw new Error(name);
  } });
  return module.exports;
};
