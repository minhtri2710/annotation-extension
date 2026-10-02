import { setIconButton } from './icons';
import { clampToolbarPosition } from './shell';
import type { ToolbarPrefs } from './ui-prefs';

export interface ToolbarControlsOptions {
  toolbar: HTMLElement;
  win: Window;
  prefs: { read(): Promise<ToolbarPrefs>; write(prefs: ToolbarPrefs): Promise<void> };
  onHide(): void;
  onPositionChange(): void;
}

export interface ToolbarControls {
  ready: Promise<void>;
  destroy(): void;
}

type Position = { x: number; y: number };

const KEY_STEP = 16;
const SHIFT_KEY_STEP = 64;
const KEY_DELTAS: Record<string, Position> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const ROVING_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function createToolbarControls(options: ToolbarControlsOptions): ToolbarControls {
  const { toolbar, win, prefs } = options;
  const document = toolbar.ownerDocument;
  let position: Position | null = null;
  let destroyed = false;
  let drag: { pointerId: number; startX: number; startY: number; origin: Position; moved: boolean } | undefined;

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.dataset.annotationToolbarGrip = '';
  setIconButton(grip, 'grip', 'Move toolbar');

  const hide = document.createElement('button');
  hide.type = 'button';
  hide.dataset.annotationToolbarHide = '';
  setIconButton(hide, 'eye-off', 'Hide toolbar on this tab');

  // ARIA toolbar pattern: one tab stop (roving tabindex), moved by Left/Right/Home/End with wrap.
  // The grip keeps its arrow keys and Home for moving the toolbar; End still leaves it.
  let stop: HTMLButtonElement | undefined;
  const items = () =>
    Array.from(toolbar.querySelectorAll('button')).filter((button) => !button.disabled && !button.hidden);
  const syncTabStop = () => {
    const shown = items();
    if (!stop || !shown.includes(stop)) stop = shown.find((button) => button !== grip) ?? shown[0];
    for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === stop ? 0 : -1;
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLButtonElement;
    if (!items().includes(target)) return;
    stop = target;
    syncTabStop();
  };
  const onToolbarKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !ROVING_KEYS.has(event.key)) return;
    const shown = items();
    const index = shown.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const last = shown.length - 1;
    const next =
      event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : (index === 0 ? last : index - 1);
    event.preventDefault();
    shown[next]!.focus();
  };
  let wasHidden = toolbar.hidden;
  const observer = new MutationObserver(() => {
    syncTabStop();
    if (wasHidden === toolbar.hidden) return;
    wasHidden = toolbar.hidden;
    if (!wasHidden) refit();
  });

  const persist = () => prefs.write({ position }).catch(() => undefined);

  const clamp = (next: Position) => {
    // A bar left past the right edge wraps narrower than it is, so its size is measured from the left edge.
    const { left, right } = toolbar.style;
    toolbar.style.left = '0px';
    toolbar.style.right = 'auto';
    const { width, height } = toolbar.getBoundingClientRect();
    toolbar.style.left = left;
    toolbar.style.right = right;
    const { clientWidth, clientHeight } = toolbar.ownerDocument.documentElement;
    return clampToolbarPosition(next, { width, height }, { width: clientWidth, height: clientHeight });
  };

  const place = (next: Position) => {
    position = clamp(next);
    toolbar.style.left = `${position.x}px`;
    toolbar.style.top = `${position.y}px`;
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
  };

  const resetPosition = () => {
    position = null;
    for (const property of ['left', 'top', 'right', 'bottom']) toolbar.style.removeProperty(property);
  };

  const currentPosition = (): Position => {
    if (position) return position;
    const rect = toolbar.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  };

  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved } = drag;
    drag = undefined;
    grip.removeAttribute('data-dragging');
    if (moved) void persist();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: currentPosition(), moved: false };
    grip.setPointerCapture(event.pointerId);
    grip.setAttribute('data-dragging', '');
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (dx === 0 && dy === 0) return;
    drag.moved = true;
    place({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    options.onPositionChange();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Home') {
      resetPosition();
    } else {
      const delta = KEY_DELTAS[event.key];
      if (!delta) return;
      const step = event.shiftKey ? SHIFT_KEY_STEP : KEY_STEP;
      const origin = currentPosition();
      place({ x: origin.x + delta.x * step, y: origin.y + delta.y * step });
    }
    event.preventDefault();
    options.onPositionChange();
    void persist();
  };

  function refit(): void {
    if (!position) return;
    const { x, y } = position;
    place(position);
    if (position.x !== x || position.y !== y) options.onPositionChange();
  }

  // A hidden bar has no box to measure, so a resize leaves its position alone and it is fitted to the viewport when it shows again.
  const onResize = () => {
    if (!toolbar.hidden) refit();
  };

  const onHideClick = () => options.onHide();

  grip.addEventListener('pointerdown', onPointerDown);
  grip.addEventListener('pointermove', onPointerMove);
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', onKeyDown);
  hide.addEventListener('click', onHideClick);
  win.addEventListener('resize', onResize);
  toolbar.addEventListener('focusin', onFocusIn);
  toolbar.addEventListener('keydown', onToolbarKeyDown);
  toolbar.prepend(grip);
  toolbar.append(hide);
  syncTabStop();
  observer.observe(toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });

  const ready = prefs.read().then(
    (stored) => {
      if (destroyed) return;
      if (stored.position) place(stored.position);
    },
    () => undefined,
  );

  return {
    ready,
    destroy() {
      destroyed = true;
      drag = undefined;
      win.removeEventListener('resize', onResize);
      grip.removeEventListener('pointerdown', onPointerDown);
      grip.removeEventListener('pointermove', onPointerMove);
      grip.removeEventListener('pointerup', endDrag);
      grip.removeEventListener('pointercancel', endDrag);
      grip.removeEventListener('keydown', onKeyDown);
      hide.removeEventListener('click', onHideClick);
      toolbar.removeEventListener('focusin', onFocusIn);
      toolbar.removeEventListener('keydown', onToolbarKeyDown);
      observer.disconnect();
      for (const button of toolbar.querySelectorAll('button')) button.removeAttribute('tabindex');
      grip.remove();
      hide.remove();
      resetPosition();
    },
  };
}
