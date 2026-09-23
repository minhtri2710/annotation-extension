import { clampToolbarPosition } from './shell';
import type { ToolbarPrefs } from './ui-prefs';

export interface ToolbarControlsOptions {
  toolbar: HTMLElement;
  win: Window;
  prefs: { read(): Promise<ToolbarPrefs>; write(prefs: ToolbarPrefs): Promise<void> };
  onCollapsedChange(collapsed: boolean): void;
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

export function createToolbarControls(options: ToolbarControlsOptions): ToolbarControls {
  const { toolbar, win, prefs } = options;
  const document = toolbar.ownerDocument;
  let position: Position | null = null;
  let collapsed = false;
  let destroyed = false;
  let drag: { pointerId: number; startX: number; startY: number; origin: Position; moved: boolean } | undefined;

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.dataset.annotationToolbarGrip = '';
  grip.setAttribute('aria-label', 'Move toolbar');
  grip.textContent = '⠿';

  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.dataset.annotationToolbarCollapse = '';

  const persist = () => prefs.write({ position, collapsed }).catch(() => undefined);

  const clamp = (next: Position) => {
    const { width, height } = toolbar.getBoundingClientRect();
    return clampToolbarPosition(next, { width, height }, { width: win.innerWidth, height: win.innerHeight });
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

  const applyCollapsed = (next: boolean) => {
    collapsed = next;
    toolbar.toggleAttribute('data-collapsed', collapsed);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.textContent = collapsed ? 'Show' : 'Hide';
    collapse.setAttribute('aria-label', `${collapse.textContent} annotation toolbar`);
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

  const onResize = () => {
    if (!position) return;
    const { x, y } = position;
    place(position);
    if (position.x !== x || position.y !== y) options.onPositionChange();
  };

  const onCollapseClick = () => {
    applyCollapsed(!collapsed);
    if (position) {
      place(position);
      options.onPositionChange();
    }
    const next = collapsed;
    void persist().then(() => options.onCollapsedChange(next));
  };

  grip.addEventListener('pointerdown', onPointerDown);
  grip.addEventListener('pointermove', onPointerMove);
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', onKeyDown);
  collapse.addEventListener('click', onCollapseClick);
  win.addEventListener('resize', onResize);
  applyCollapsed(false);
  toolbar.prepend(grip);
  toolbar.append(collapse);

  const ready = prefs.read().then(
    (stored) => {
      if (destroyed) return;
      applyCollapsed(stored.collapsed);
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
      collapse.removeEventListener('click', onCollapseClick);
      grip.remove();
      collapse.remove();
      toolbar.removeAttribute('data-collapsed');
      resetPosition();
    },
  };
}
