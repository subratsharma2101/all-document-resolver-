import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { File, Paths } from 'expo-file-system';

// Two palettes sharing the same token names so every screen can theme by reference
// instead of hardcoded hex. Light is the mockup-inspired white/blue look; dark keeps
// the original deep-slate feel. File-type accents are shared across both.
const accents = {
  pdf: '#f4553d',
  image: '#2ea36b',
  text: '#3f7ef4',
  signature: '#a065f0',
};

const light = {
  name: 'light',
  bg: '#f5f7fb',
  surface: '#ffffff',
  surfaceAlt: '#eef1f7',
  card: '#ffffff',
  border: '#e3e8f0',
  text: '#12151c',
  textMuted: '#5c6472',
  textFaint: '#8a92a2',
  primary: '#2f6bff',
  primaryText: '#ffffff',
  onPrimarySurface: '#e8f0ff',
  chip: '#eef1f7',
  chipText: '#3a4252',
  chipOn: '#2f6bff',
  chipTextOn: '#ffffff',
  danger: '#d63a4f',
  dangerBg: '#fdecef',
  success: '#1f9d63',
  warn: '#b8791b',
  overlayViewer: '#f0f2f7',
  scrim: '#0b0e14aa',
  statusBar: 'dark',
  shadow: '#1a2b5233',
  accents,
};

const dark = {
  name: 'dark',
  bg: '#0f1115',
  surface: '#191d26',
  surfaceAlt: '#20242f',
  card: '#191d26',
  border: '#252a35',
  text: '#f4f5f8',
  textMuted: '#9299a8',
  textFaint: '#687384',
  primary: '#4f8cff',
  primaryText: '#ffffff',
  onPrimarySurface: '#1a2233',
  chip: '#252a35',
  chipText: '#c7ccd6',
  chipOn: '#4f8cff',
  chipTextOn: '#ffffff',
  danger: '#ff6b6b',
  dangerBg: '#34202a',
  success: '#74cca6',
  warn: '#e7c979',
  overlayViewer: '#0f1115',
  scrim: '#0009',
  statusBar: 'light',
  shadow: '#00000000',
  accents,
};

export const THEMES = { light, dark };

const settingsFile = () => new File(Paths.document, 'settings.json');

function loadSavedMode() {
  try {
    const file = settingsFile();
    if (!file.exists) return null;
    const saved = JSON.parse(file.text());
    return saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : null;
  } catch {
    return null; // A missing or corrupt settings file just falls back to the system scheme.
  }
}

function saveMode(mode) {
  try {
    const file = settingsFile();
    let data = {};
    if (file.exists) { try { data = JSON.parse(file.text()); } catch { data = {}; } }
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

  const value = useMemo(() => {
    const active = mode === 'light' ? 'light' : 'dark';
    return {
      theme: THEMES[active],
      mode: active,
      ready: mode !== null,
      toggle: () => {
        setMode(current => {
          const next = current === 'light' ? 'dark' : 'light';
          explicit.current = true;
          saveMode(next);
          return next;
        });
      },
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
