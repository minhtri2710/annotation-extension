import { OVERLAY_STYLES } from './styles';

export const TOOLBAR_MOUNT = 'toolbar' as const;
export const PANEL_MOUNT = 'panel' as const;

export interface OverlayShell {
  root: HTMLDivElement;
  toolbar: HTMLDivElement;
  panel: HTMLDivElement;
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

export interface PanelAnchor {
  place(box: () => { x: number; y: number; width: number; height: number }): void;
  clear(): void;
  destroy(): void;
}

const PANEL_MARGIN = 10;
const PANEL_PLACEMENT = ['position', 'top', 'left', 'right', 'bottom', 'max-height'] as const;

// Keeps a placed panel inside the viewport and clear of the toolbar, which paints above it: its
// height is capped to the free room below its top (the panel scrolls internally, and a focused
// control is scrolled fully into view), and it is placed again whenever it or the window resizes.
export function createPanelAnchor(panel: HTMLElement, toolbar: HTMLElement): PanelAnchor {
  const document = panel.ownerDocument;
  const win = document.defaultView!;
  let source: (() => { x: number; y: number; width: number; height: number }) | undefined;

  const update = () => {
    if (!source) return;
    panel.style.removeProperty('max-height');
    const { width, height } = panel.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const placed = positionPopover(source(), { width, height }, viewport);
    const { left } = placed;
    let { top } = placed;
    let bottom = viewport.height - PANEL_MARGIN;
    const bar = toolbar.getBoundingClientRect();
    if (bar.width > 0 && bar.left < left + width && bar.right > left) {
      if (bar.top > top) bottom = Math.min(bottom, bar.top - PANEL_MARGIN);
      else if (bar.bottom > top) top = bar.bottom + PANEL_MARGIN;
    }
    panel.style.position = 'fixed';
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  };
  // Browsers leave a partly visible control partly clipped when it takes focus, and Firefox's own
  // focus scroll can land after a synchronous one, so the reveal runs on the next frame.
  const reveal = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof win.Element)) return;
    win.requestAnimationFrame(() => {
      if (target.isConnected) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const observer = new ResizeObserver(update);
  observer.observe(panel);
  win.addEventListener('resize', update);
  panel.addEventListener('focusin', reveal);

  const clear = () => {
    source = undefined;
    for (const property of PANEL_PLACEMENT) panel.style.removeProperty(property);
  };
  return {
    place(box) {
      source = box;
      update();
    },
    clear,
    destroy() {
      clear();
      observer.disconnect();
      win.removeEventListener('resize', update);
      panel.removeEventListener('focusin', reveal);
    },
  };
}

// Puts the overlay host in the browser's top layer: above every page z-index, and placed against
// the viewport even when <html> or <body> is transformed, filtered or contained.
export function raiseOverlay(host: HTMLElement): void {
  host.popover = 'manual';
  host.showPopover();
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

export function buildOverlayShell(container: HTMLElement): OverlayShell {
  const document = container.ownerDocument;
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  const panel = document.createElement('div');
  const style = document.createElement('style');

  style.textContent = OVERLAY_STYLES;
  root.dataset.annotationShell = '';
  toolbar.dataset.annotationMount = TOOLBAR_MOUNT;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Annotation tools');
  panel.dataset.annotationMount = PANEL_MOUNT;
  panel.setAttribute('role', 'region');
  root.append(toolbar, panel);
  container.replaceChildren(style, root);

  return { root, toolbar, panel };
}

// A polite status region; announce writes only when the text changes, so a re-render does not re-announce.
export function createLiveRegion(document: Document): { element: HTMLParagraphElement; announce(text: string): void } {
  const element = document.createElement('p');
  element.dataset.annotationLive = '';
  element.setAttribute('role', 'status');
  return {
    element,
    announce(text) {
      if (element.textContent !== text) element.textContent = text;
    },
  };
}

export interface InlineConfirmOptions {
  trigger: HTMLButtonElement;
  question: string;
  confirmLabel: string;
  ariaLabel: string;
  onConfirm(): void;
  dataPrefix: string;
}

// Clicking the trigger swaps it for an inline prompt; only the prompt's confirm button acts.
// Returns the dismiss function, which swaps the trigger back and focuses it.
export function createInlineConfirm(document: Document, options: InlineConfirmOptions): () => void {
  const { trigger, dataPrefix } = options;
  const prompt = document.createElement('div');
  prompt.setAttribute(`data-${dataPrefix}-prompt`, '');
  prompt.setAttribute('role', 'group');
  const question = document.createElement('p');
  question.textContent = options.question;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.setAttribute(`data-${dataPrefix}-confirm`, '');
  confirm.dataset.variant = 'danger';
  confirm.textContent = options.confirmLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.setAttribute(`data-${dataPrefix}-cancel`, '');
  cancel.textContent = 'Cancel';
  prompt.setAttribute('aria-label', options.ariaLabel);
  prompt.append(question, confirm, cancel);

  const dismiss = () => {
    prompt.replaceWith(trigger);
    trigger.focus();
  };
  trigger.addEventListener('click', () => {
    trigger.replaceWith(prompt);
    cancel.focus();
  });
  confirm.addEventListener('click', () => options.onConfirm());
  cancel.addEventListener('click', dismiss);
  prompt.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Escape here dismisses the prompt only; it must not also close the panel.
    event.stopPropagation();
    dismiss();
  });
  return dismiss;
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
