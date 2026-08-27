import { useEffect, useState } from 'react';

const KEY = 'latin-mv-tlt:theme';
type Theme = 'light' | 'dark';

/**
 * R-6.8. Two halves were missing: the toggle never consulted
 * `prefers-color-scheme`, so a user whose OS is dark got a light app; and it
 * never persisted, so every reload threw the choice away.
 *
 * Precedence is explicit choice → system preference → light, which is the same
 * order the published Artifacts use and the one users expect: once someone has
 * picked, the OS no longer overrides them.
 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function storedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'dark' || raw === 'light' ? raw : null;
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null. A theme is not worth failing a render over.
    return null;
  }
}

function initialTheme(): Theme {
  return storedTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

export function useDarkMode() {
  // Read synchronously on the first render, so the app does not paint light and
  // then flip to dark once an effect has run.
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const dark = theme === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // See storedTheme.
    }
  }, [theme]);

  // Follow the OS only while the user has made no explicit choice.
  useEffect(() => {
    if (storedTheme()) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return { dark, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
