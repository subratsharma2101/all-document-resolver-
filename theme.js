import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as SystemUI from 'expo-system-ui';

// One spacing/radius/type scale for every screen. Ad-hoc per-screen numbers were the
// main reason the UI looked busy, so layout values now come from here instead.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };
export const type = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
};
export const hairline = StyleSheet.hairlineWidth;

// Native press feedback. Android gets a real ripple; iOS falls back to opacity.
export function rippleFor(color) {
  return Platform.OS === 'android' ? { color, borderless: false, foreground: true } : undefined;
}
export const pressedOpacity = (pressed, disabled) => (disabled ? 0.4 : pressed && Platform.OS !== 'android' ? 0.6 : 1);

// Shared semantic colors keep the workspace, editors and reader consistent.
const accents = {
  pdf: '#b25741',
  image: '#1f7a64',
  text: '#4a67a6',
  signature: '#85619e',
};

const light = {
  name: 'light',
  bg: '#f6f7f7',
  surface: '#ffffff',
  surfaceAlt: '#f0f2f2',
  card: '#ffffff',
  border: '#e3e7e6',
  text: '#16211f',
  textMuted: '#5e6b68',
  textFaint: '#8a9592',
  primary: '#146b57',
  primaryText: '#ffffff',
  onPrimarySurface: '#e7f1ed',
  chip: '#f0f2f2',
  chipText: '#43544f',
  chipOn: '#146b57',
  chipTextOn: '#ffffff',
  danger: '#c33a4c',
  dangerBg: '#fbecee',
  success: '#1d8f5c',
  warn: '#a9711a',
  overlayViewer: '#eceeee',
  scrim: '#10181699',
  ripple: '#16211f1f',
  skeleton: '#e9ecec',
  statusBar: 'dark',
  shadow: 'transparent',
  accents,
};

const dark = {
  name: 'dark',
  bg: '#0f1514',
  surface: '#161d1c',
  surfaceAlt: '#1f2726',
  card: '#161d1c',
  border: '#283130',
  text: '#edf1f0',
  textMuted: '#9ba7a4',
  textFaint: '#7c8886',
  primary: '#7fd4b4',
  primaryText: '#0d2a24',
  onPrimarySurface: '#1c2f2a',
  chip: '#1f2726',
  chipText: '#c2cfcb',
  chipOn: '#7fd4b4',
  chipTextOn: '#0d2a24',
  danger: '#f08080',
  dangerBg: '#2c1d20',
  success: '#6fc8a2',
  warn: '#dcc07a',
  overlayViewer: '#0f1514',
  scrim: '#000000b3',
  ripple: '#edf1f026',
  skeleton: '#1f2726',
  statusBar: 'light',
  shadow: 'transparent',
  accents: { pdf: '#e4947d', image: '#7fd4b4', text: '#9ab2e2', signature: '#bfa0dd' },
};

export const THEMES = { light, dark };

const settingsFile = () => new File(Paths.document, 'settings.json');

function loadSavedMode() {
  try {
    const file = settingsFile();
    if (!file.exists) return null;
    const saved = JSON.parse(file.textSync());
    return saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : null;
  } catch {
    return null; // A missing or corrupt settings file just falls back to the system scheme.
  }
}

function saveMode(mode) {
  try {
    const file = settingsFile();
    let data = {};
    if (file.exists) { try { data = JSON.parse(file.textSync()); } catch { data = {}; } }
    data.theme = mode;
    file.write(JSON.stringify(data));
  } catch { /* Persisting the preference is best effort; the app still themes in-memory. */ }
}

const ThemeContext = createContext({ theme: dark, mode: 'dark', toggle: () => {}, ready: false });

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState(null); // null until we've read the saved choice
  const explicit = useRef(false); // Once the user toggles, stop following the system.

  useEffect(() => {
    const saved = loadSavedMode();
    if (saved) { explicit.current = true; setMode(saved); }
    else setMode(systemScheme === 'light' ? 'light' : 'dark');
  }, []);

  // Track the system scheme until the user makes an explicit choice.
  useEffect(() => {
    if (!explicit.current && mode !== null) setMode(systemScheme === 'light' ? 'light' : 'dark');
  }, [systemScheme]);

  // Keep the root view behind React in sync, so theme switches and screen
  // transitions never flash the opposite background.
  useEffect(() => {
    if (mode === null) return;
    SystemUI.setBackgroundColorAsync(THEMES[mode].bg).catch(() => {});
  }, [mode]);

  const value = useMemo(() => {
    const active = mode === 'light' ? 'light' : 'dark';
    return {
      theme: THEMES[active],
      mode: active,
      ready: mode !== null,
      toggle: () => {
        const next = active === 'light' ? 'dark' : 'light';
        explicit.current = true;
        saveMode(next);
        setMode(next);
      },
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
