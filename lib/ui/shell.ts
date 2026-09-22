import { applyThemeMode, resolveThemeMode } from './theme';
import type { PrefersDarkSignal, ThemePreference } from './theme';
import { OVERLAY_STYLES } from './styles';

export const TOOLBAR_MOUNT = 'toolbar' as const;
export const PANEL_MOUNT = 'panel' as const;

export interface OverlayShell {
  root: HTMLDivElement;
  toolbar: HTMLDivElement;
  panel: HTMLDivElement;
}

export interface OverlayShellOptions {
  theme?: ThemePreference;
  prefersDark?: PrefersDarkSignal;
}

export function buildOverlayShell(
  container: HTMLElement,
  options: OverlayShellOptions = {},
): OverlayShell {
  const document = container.ownerDocument;
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  const panel = document.createElement('div');
  const style = document.createElement('style');

  style.textContent = OVERLAY_STYLES;
  root.dataset.annotationShell = '';
  toolbar.dataset.annotationMount = TOOLBAR_MOUNT;
  panel.dataset.annotationMount = PANEL_MOUNT;
  applyThemeMode(root, resolveThemeMode(options.theme ?? 'system', options.prefersDark));
  root.append(toolbar, panel);
  container.replaceChildren(style, root);

  return { root, toolbar, panel };
}
