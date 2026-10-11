// Keep native identity and permission settings from app.json; brand assets live
// alongside the refreshed interface. A native rebuild picks up launcher changes.
module.exports = ({ config }) => ({
  ...config,
  name: 'File Viewer',
  version: '1.1.0',
  userInterfaceStyle: 'automatic',
  icon: './branding/fileviewer-icon.png',
  android: {
    ...config.android,
    versionCode: Math.max(config.android?.versionCode || 1, 2),
    adaptiveIcon: { backgroundColor: '#102F36', foregroundImage: './branding/fileviewer-icon.png' },
  },
  web: { ...config.web, favicon: './branding/fileviewer-icon.png' },
});
