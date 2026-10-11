const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dependencies = Object.keys(require('../package.json').dependencies);
const names = [...new Set([...dependencies, '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib'])].sort();
const notices = names.map(name => {
  let directory = path.join(root, 'node_modules', name);
  if (!fs.existsSync(path.join(directory, 'package.json'))) {
    directory = path.dirname(require.resolve(name, { paths: [path.join(root, 'node_modules', 'pdf-lib')] }));
    while (true) {
      const metadata = path.join(directory, 'package.json');
      if (fs.existsSync(metadata) && JSON.parse(fs.readFileSync(metadata, 'utf8')).name === name) break;
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Cannot locate package metadata for ${name}`);
      directory = parent;
    }
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const licenses = fs.readdirSync(directory).filter(file => /^licen[sc]e(?:\.|$)/i.test(file));
  if (!licenses.length) throw new Error(`Missing license text for ${name}`);
  return { name, version: metadata.version, license: metadata.license,
    text: licenses.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n\n') };
});
fs.writeFileSync(path.join(root, 'assets', 'third-party-notices.json'), `${JSON.stringify(notices, null, 2)}\n`);
console.log(`Bundled ${notices.length} third-party license notices.`);
