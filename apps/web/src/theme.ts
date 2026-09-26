// Light or dark look. Without a choice the page follows the phone or computer setting; a choice made with the
// button is kept in this browser only. index.html applies the same rule before the first paint.
export type Theme = 'light' | 'dark';
const KEY = 'fontokmai.theme';
const THEME_COLOR: Record<Theme, string> = { light: '#075e57', dark: '#0a2f35' };

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}
