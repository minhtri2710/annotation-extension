export type ThemeMode = 'light' | 'dark';

export function applyThemeMode(root: HTMLElement, mode: ThemeMode): void {
  root.dataset.theme = mode;
}

// Keeps the overlay on the system light/dark setting, including changes while it is mounted.
export function watchColorScheme(root: HTMLElement, view: Window): () => void {
  if (typeof view.matchMedia !== 'function') {
    applyThemeMode(root, 'light');
    return () => undefined;
  }
  const query = view.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => applyThemeMode(root, query.matches ? 'dark' : 'light');
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
