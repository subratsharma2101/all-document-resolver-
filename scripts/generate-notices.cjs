const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dependencies = Object.keys(require('../package.json').dependencies);
const names = [...new Set([...dependencies, '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib'])].sort();
const notices = names.map(name => {
  const directory = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const licenses = fs.readdirSync(directory).filter(file => /^licen[sc]e(?:\.|$)/i.test(file));
  if (!licenses.length) throw new Error(`Missing license text for ${name}`);
  return { name, version: metadata.version, license: metadata.license,
    text: licenses.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n\n') };
});
fs.writeFileSync(path.join(root, 'assets', 'third-party-notices.json'), `${JSON.stringify(notices, null, 2)}\n`);
console.log(`Bundled ${notices.length} third-party license notices.`);
