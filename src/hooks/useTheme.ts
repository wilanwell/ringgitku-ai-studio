import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'ringgitku.theme.v1';
const THEME_CHANGE_EVENT = 'ringgitku-theme-change';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage errors
  }
  return 'light';
}

function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#020617' : '#0F172A');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  useEffect(() => {
    const handleSync = (event: Event) => {
      const custom = event as CustomEvent<ThemeMode>;
      if (custom.detail === 'light' || custom.detail === 'dark') {
        setThemeState(custom.detail);
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleSync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleSync);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
    applyThemeToDom(next);
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
