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

export function positionPopover(
  box: { x: number; y: number; width: number; height: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { top: number; left: number } {
  const fitsBelow = box.y + box.height + gap + panel.height <= viewport.height;
  const top = fitsBelow ? box.y + box.height + gap : box.y - gap - panel.height;
  const maxLeft = viewport.width - panel.width - 10;

  return {
    top: Math.max(10, top),
    left: Math.max(10, Math.min(box.x, maxLeft)),
  };
}

export function clampToolbarPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(position.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(position.y, viewport.height - size.height - margin)),
  };
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
  panel.setAttribute('role', 'region');
  applyThemeMode(root, resolveThemeMode(options.theme ?? 'system', options.prefersDark));
  root.append(toolbar, panel);
  container.replaceChildren(style, root);

  return { root, toolbar, panel };
}

// Call before a panel re-render; the returned function refocuses the equivalent control
// (same data-annotation-* attributes, same annotation) or the panel heading, so focus never
// drops to <body>. It does nothing when focus was outside the panel.
export function keepPanelFocus(panel: HTMLElement): () => void {
  const root = panel.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement;
  if (!active || !panel.contains(active)) return () => undefined;

  const selector = Array.from(active.attributes)
    .filter((attribute) => attribute.name.startsWith('data-annotation-'))
    .map((attribute) => `[${attribute.name}="${CSS.escape(attribute.value)}"]`)
    .join('');
  const owner = active.parentElement?.closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
  const scope = owner ? `[data-annotation-id="${CSS.escape(owner)}"] ` : '';
  return () => {
    if (panel.contains(root.activeElement)) return;
    const target = selector ? panel.querySelector<HTMLElement>(`${scope}${selector}`) : null;
    (target ?? panel.querySelector<HTMLElement>('h2'))?.focus();
  };
}
