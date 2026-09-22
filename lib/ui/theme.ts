export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeMode = Exclude<ThemePreference, 'system'>;
export type PrefersDarkSignal = () => boolean | undefined;

export function resolveThemeMode(
  preference: ThemePreference,
  prefersDark?: PrefersDarkSignal,
): ThemeMode {
  if (preference !== 'system') return preference;
  return prefersDark?.() === true ? 'dark' : 'light';
}

export function applyThemeMode(root: HTMLElement, mode: ThemeMode): void {
  root.dataset.theme = mode;
}
