const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { expo } = require('../app.json');
const eas = require('../eas.json');
const { dependencies, devDependencies } = require('../package.json');
const props = expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')?.[1]?.android;

assert.ok(props?.targetSdkVersion >= 36, 'Target API 36 or newer is required.');
assert.ok(props.compileSdkVersion >= props.targetSdkVersion);
assert.equal(props.usesCleartextTraffic, false);
assert.equal(props.useLegacyPackaging, false);
assert.equal(props.enableMinifyInReleaseBuilds, true);
assert.equal(props.enableShrinkResourcesInReleaseBuilds, true);
assert.equal(expo.android.allowBackup, false);
assert.ok(Number.isInteger(expo.android.versionCode) && expo.android.versionCode > 0);
for (const permission of ['MANAGE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'RECORD_AUDIO']) {
  assert.ok(expo.android.blockedPermissions.includes(`android.permission.${permission}`), `Unexpected broad permission: ${permission}`);
}
assert.equal(eas.build.production.android.buildType, 'app-bundle');
assert.equal(eas.build.production.autoIncrement, true);
assert.equal(eas.build.preview.android.buildType, 'apk');
assert.ok(dependencies['expo-image']);
assert.equal(devDependencies?.['eas-cli'], undefined, 'Use EAS CLI through npx, not as an app dependency.');

const android = path.join(root, 'android');
assert.ok(fs.existsSync(android), 'Run npx expo prebuild --platform android --no-install before native config verification.');
const gradle = fs.readFileSync(path.join(android, 'gradle.properties'), 'utf8');
const manifest = fs.readFileSync(path.join(android, 'app/src/main/AndroidManifest.xml'), 'utf8');
assert.match(gradle, /android.targetSdkVersion=36/);
assert.match(gradle, /android.enableMinifyInReleaseBuilds=true/);
assert.match(gradle, /android.enableShrinkResourcesInReleaseBuilds=true/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
for (const permission of expo.android.blockedPermissions) {
  const declarations = manifest.match(/<uses-permission\b[^>]*>/g) || [];
  assert.ok(!declarations.some(tag => tag.includes(`android:name="${permission}"`) && !tag.includes('tools:node="remove"')), `Permission still granted: ${permission}`);
}
console.log('Release configuration and generated Android manifest checks passed.');
console.log('NOT verified here: native compilation, final merged AAB permissions, 16 KB ELF alignment, signing credentials, device tests or Play Console declarations.');
