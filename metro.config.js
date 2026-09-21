const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the pdf.js library/worker (saved as .txt) as loadable assets.
config.resolver.assetExts.push('txt');

module.exports = config;
