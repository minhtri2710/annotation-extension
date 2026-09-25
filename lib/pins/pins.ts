import type { Annotation } from '../annotation';
import { resolveSelector } from '../capture/selector';
import { cssZoom, placeFixed } from '../capture/selection';

export interface PinsController {
  setAnnotations(annotations: Annotation[]): void;
  reanchor(): void;
  destroy(): void;
}

export interface PinsControllerOptions {
  document: Document;
  container: HTMLElement;
  toolbar: HTMLElement;
  onActivate?: (annotation: Annotation) => void;
}

interface PendingAnnotation {
  annotation: Annotation;
  index: number;
}

interface TrackedPin extends PendingAnnotation {
  element: Element;
  marker: HTMLButtonElement;
  hovered: boolean;
  focused: boolean;
  pulseTimeout?: number;
}

const BADGE_ATTRIBUTE = 'data-annotation-badge';
const MARKER_ATTRIBUTE = 'data-annotation-id';
const TOOLTIP_ATTRIBUTE = 'data-annotation-tooltip';
const PIN_CLASS = 'annotation-pin';
const PULSE_CLASS = 'locate-pulse';
const NOTE_PREVIEW_LENGTH = 120;
const PIN_SIZE = 18;
const FAN_GAP = 4;
// Overflow rows are searched at most this many row steps below and above a pin's centre.
const FAN_ROWS = 4;
const TOOLTIP_GAP = 8;
const TOOLTIP_MARGIN = 8;
export const RERESOLVE_DEBOUNCE_MS = 250;
export const RERESOLVE_MAX_WAIT_MS = 1000;
export const RERESOLVE_BACKOFF_CAP_MS = 30_000;
// Same budget as the lint engine's SCAN_SLICE_MS.
export const RESOLVE_SLICE_MS = 12;
const MARKER_STYLE = [
  'position: fixed',
  'z-index: 2147483647',
  `width: ${PIN_SIZE}px`,
  `height: ${PIN_SIZE}px`,
  'padding: 0',
  'border: 2px solid #ffffff',
  'border-radius: 50%',
  'background: #2f6fed',
  'box-shadow: 0 1px 4px rgba(23, 32, 51, 0.35)',
  'color: #ffffff',
  'cursor: pointer',
  'line-height: 14px',
  'pointer-events: auto',
  'transform: translate(-50%, -50%)',
].join(';');

interface Viewport {
  width: number;
  height: number;
}

// An element that does not intersect the viewport, including a display: none one with an all-zero rect,
// shows no pin.
export function intersectsViewport(
  rect: { left: number; top: number; right: number; bottom: number },
  viewport: Viewport,
): boolean {
  return rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
}

// For a rect that intersects the viewport, the pin is centred on its top-left corner, pulled fully inside
// the viewport. A pin under page zoom measures PIN_SIZE * zoom.
export function pinCenter(
  rect: { left: number; top: number; right: number; bottom: number },
  viewport: Viewport,
  zoom = 1,
): { x: number; y: number } {
  const half = (PIN_SIZE * zoom) / 2;
  return { x: clamp(rect.left, half, viewport.width - half), y: clamp(rect.top, half, viewport.height - half) };
}

// On-screen pins are placed in list order so no two PIN_SIZE * zoom squares overlap: each keeps its
// centre when that is free, else takes the first free slot k * (PIN_SIZE + FAN_GAP) * zoom to the right
// that stays inside the viewport, then the first free one to the left, keeping its y. A slot whose square
// overlaps the toolbar rect counts as taken, own centre included; one only touching its edge is free, and a
// toolbar rect with zero width or height excludes nothing. A row with no free slot left sends the pin to
// the nearest row with one, (PIN_SIZE + FAN_GAP) * zoom below, then above, then twice that, and so on up to
// FAN_ROWS steps, skipping rows outside the viewport and trying the same slots in the same order. When
// every slot in that band is taken, the pin sits at its own x in the first band row in the same order
// whose slot there is off the toolbar, overlapping other pins, or at its own centre when there is none.
// Every centre lies inside [half, width - half] x [half, height - half], as pinCenter returns it.
export function fanOut(
  centers: { x: number; y: number }[],
  viewport: Viewport,
  toolbar: { left: number; top: number; right: number; bottom: number },
  zoom = 1,
): { x: number; y: number }[] {
  const size = PIN_SIZE * zoom;
  const half = size / 2;
  const step = (PIN_SIZE + FAN_GAP) * zoom;
  const blocks = toolbar.right > toolbar.left && toolbar.bottom > toolbar.top;
  const onToolbar = (x: number, y: number) =>
    blocks && x - half < toolbar.right && x + half > toolbar.left && y - half < toolbar.bottom && y + half > toolbar.top;
  // Row r: 0 own, then 1 below, 2 above, 3 two below, ...
  const offset = (r: number) => (r % 2 ? (r + 1) / 2 : -r / 2) * step;
  const inView = (r: number, rowY: number) => r === 0 || (rowY >= half && rowY <= viewport.height - half);
  // Placed pins in cells of one pin size, indexed [row band + 1][column + 1] so a neighbour index is never
  // negative: a pin overlapping a slot lies in one of the nine cells around it.
  const cells: { x: number; y: number }[][][] = [];
  // Per centre y then x, the row (0 own, then 1 below, 2 above, 3 two below, ...) and the slot in it after
  // the one its last pin took (0 centre, k > 0 right, k < 0 left), or row FULL. Pins only accumulate, so
  // every slot before it in the order is still taken for that centre.
  const FULL = Infinity;
  const resume = new Map<number, Map<number, { row: number; slot: number }>>();
  const taken = (slot: number, y: number, band: number) => {
    if (onToolbar(slot, y)) return true;
    const column = Math.floor(slot / size) + 1;
    for (let b = band; b <= band + 2; b++) {
      const row = cells[b];
      if (!row) continue;
      for (let c = column - 1; c <= column + 1; c++) {
        const cell = row[c];
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          if (Math.abs(cell[i]!.x - slot) < size && Math.abs(cell[i]!.y - y) < size) return true;
        }
      }
    }
    return false;
  };
  // The first free slot from k on in the row at y, or FULL.
  const freeSlot = (x: number, y: number, k: number) => {
    const band = Math.floor(y / size);
    if (k === 0) {
      if (!taken(x, y, band)) return 0;
      k = 1;
    }
    if (k > 0) {
      while (x + k * step <= viewport.width - half && taken(x + k * step, y, band)) k++;
      if (x + k * step <= viewport.width - half) return k;
      k = -1;
    }
    while (x - -k * step >= half && taken(x - -k * step, y, band)) k--;
    return x - -k * step >= half ? k : FULL;
  };
  return centers.map((center) => {
    const { x, y } = center;
    let slots = resume.get(y);
    if (!slots) resume.set(y, (slots = new Map()));
    let { row: r, slot } = slots.get(x) ?? { row: 0, slot: 0 };
    let pin: { x: number; y: number } | undefined;
    while (r !== FULL) {
      const distance = Math.abs(offset(r));
      if (r > 2 * FAN_ROWS || (r > 0 && distance > y - half && distance > viewport.height - half - y)) {
        r = FULL;
        break;
      }
      const rowY = y + offset(r);
      if (inView(r, rowY)) {
        slot = freeSlot(x, rowY, slot);
        if (slot !== FULL) {
          pin = { x: x - -slot * step, y: rowY };
          break;
        }
      }
      r++;
      slot = 0;
    }
    slots.set(x, { row: r, slot: slot < 0 ? slot - 1 : slot + 1 });
    if (!pin) {
      pin = { x, y };
      for (let b = 0; b <= 2 * FAN_ROWS; b++) {
        const rowY = y + offset(b);
        if (inView(b, rowY) && !onToolbar(x, rowY)) {
          pin = { x, y: rowY };
          break;
        }
      }
    }
    const row = (cells[Math.floor(pin.y / size) + 1] ??= []);
    const column = Math.floor(pin.x / size) + 1;
    const cell = row[column];
    if (cell) cell.push(pin);
    else row[column] = [pin];
    return pin;
  });
}

// Right of the pin, or left of it when the right side has no room, then clamped into the viewport.
export function placeTooltip(
  pin: { left: number; top: number; right: number },
  size: Viewport,
  viewport: Viewport,
): { left: number; top: number } {
  let left = pin.right + TOOLTIP_GAP;
  if (left + size.width > viewport.width - TOOLTIP_MARGIN) left = pin.left - TOOLTIP_GAP - size.width;
  return {
    left: clamp(left, TOOLTIP_MARGIN, viewport.width - TOOLTIP_MARGIN - size.width),
    top: clamp(pin.top, TOOLTIP_MARGIN, viewport.height - TOOLTIP_MARGIN - size.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function createPinsController(options: PinsControllerOptions): PinsController {
  const view = options.document.defaultView;
  const badge = options.document.createElement('span');
  badge.setAttribute(BADGE_ATTRIBUTE, '');
  const badgeCount = options.document.createTextNode('0');
  const badgeUnit = options.document.createElement('span');
  badgeUnit.setAttribute('data-annotation-badge-unit', '');
  badge.append(badgeCount, badgeUnit);
  options.toolbar.append(badge);

  let trackedPins: TrackedPin[] = [];
  let unresolved: PendingAnnotation[] = [];
  let frame: number | undefined;
  let resolveTimer: number | undefined;
  let maxWaitTimer: number | undefined;
  let tooltip: HTMLDivElement | undefined;
  let tooltipPin: TrackedPin | undefined;
  let destroyed = false;
  // Doubles after each re-resolve pass that pins nothing new; 1 again once one does or the set changes.
  let backoff = 1;
  let sliceTimer: number | undefined;
  let resolving = false;
  let mutatedWhileResolving = false;

  const reanchor = () => {
    if (destroyed) return;

    const size = viewport();
    const visible: TrackedPin[] = [];
    const rects: DOMRect[] = [];
    for (const pin of trackedPins) {
      const rect = pin.element.isConnected ? pin.element.getBoundingClientRect() : undefined;
      pin.marker.hidden = !rect || !intersectsViewport(rect, size);
      if (rect && !pin.marker.hidden) {
        visible.push(pin);
        rects.push(rect);
      } else {
        // An engine need not fire mouseleave or blur on a marker that becomes hidden.
        pin.hovered = false;
        pin.focused = false;
        if (pin === tooltipPin) hideTooltip();
      }
    }
    if (visible.length === 0) return;

    // Every marker lives in the same container, so they share one zoom.
    const zoom = cssZoom(visible[0]!.marker);
    const centers = rects.map((rect) => pinCenter(rect, size, zoom));
    fanOut(centers, size, options.toolbar.getBoundingClientRect(), zoom).forEach(({ x, y }, i) => placeFixed(visible[i]!.marker, { left: x, top: y }));
  };

  const scheduleReanchor = () => {
    if (destroyed || frame !== undefined) return;
    frame = view?.requestAnimationFrame(() => {
      frame = undefined;
      reanchor();
    });
  };

  const reresolve = () => {
    const detached = trackedPins.filter((pin) => !pin.element.isConnected);
    for (const pin of detached) {
      clearPulse(pin);
      pin.marker.remove();
      if (pin === tooltipPin) hideTooltip();
    }
    trackedPins = trackedPins.filter((pin) => pin.element.isConnected);
    const pending = [...unresolved, ...detached].sort((a, b) => a.index - b.index);
    unresolved = [];
    resolvePending(pending, true);
  };

  const scheduleReresolve = () => {
    if (destroyed) return;
    if (resolving) {
      mutatedWhileResolving = true;
      return;
    }
    if (unresolved.length === 0 && trackedPins.every((pin) => pin.element.isConnected)) return;
    if (resolveTimer !== undefined) view?.clearTimeout(resolveTimer);
    resolveTimer = view?.setTimeout(runReresolve, Math.min(RERESOLVE_DEBOUNCE_MS * backoff, RERESOLVE_BACKOFF_CAP_MS));
    maxWaitTimer ??= view?.setTimeout(runReresolve, Math.min(RERESOLVE_MAX_WAIT_MS * backoff, RERESOLVE_BACKOFF_CAP_MS));
  };

  const runReresolve = () => {
    cancelReresolve();
    reresolve();
  };

  const observer = new MutationObserver(() => {
    scheduleReanchor();
    scheduleReresolve();
  });
  observer.observe(options.document, { childList: true, subtree: true });
  options.document.addEventListener('scroll', scheduleReanchor, true);
  view?.addEventListener('resize', scheduleReanchor, true);
  // WCAG 1.4.13: Escape dismisses the tooltip without moving focus or the pointer.
  const dismissTooltip = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tooltip) hideTooltip();
  };
  options.document.addEventListener('keydown', dismissTooltip, true);

  const setAnnotations = (annotations: Annotation[]) => {
    for (const pin of trackedPins) {
      clearPulse(pin);
      pin.marker.remove();
    }
    trackedPins = [];
    hideTooltip();
    badgeCount.data = String(annotations.length);
    badgeUnit.textContent = annotations.length === 1 ? ' annotation' : ' annotations';

    unresolved = [];
    cancelReresolve();
    cancelPass();
    backoff = 1;
    resolvePending(annotations.map((annotation, index) => ({ annotation, index })), false);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect();
    options.document.removeEventListener('scroll', scheduleReanchor, true);
    view?.removeEventListener('resize', scheduleReanchor, true);
    options.document.removeEventListener('keydown', dismissTooltip, true);
    if (frame !== undefined) {
      view?.cancelAnimationFrame(frame);
      frame = undefined;
    }
    cancelReresolve();
    cancelPass();
    unresolved = [];
    for (const pin of trackedPins) {
      clearPulse(pin);
      pin.marker.remove();
    }
    trackedPins = [];
    hideTooltip();
    badge.remove();
  };

  return { setAnnotations, reanchor, destroy };

  function cancelReresolve(): void {
    if (resolveTimer !== undefined) view?.clearTimeout(resolveTimer);
    if (maxWaitTimer !== undefined) view?.clearTimeout(maxWaitTimer);
    resolveTimer = undefined;
    maxWaitTimer = undefined;
  }

  // Tracks in list order, yielding a macrotask whenever a slice reaches RESOLVE_SLICE_MS, so pins
  // appear progressively. setAnnotations and destroy cancel a running pass through cancelPass.
  function resolvePending(pending: PendingAnnotation[], adjustBackoff: boolean): void {
    const pinnedBefore = trackedPins.length;
    let next = 0;
    resolving = true;
    mutatedWhileResolving = false;
    const slice = () => {
      sliceTimer = undefined;
      const start = performance.now();
      while (next < pending.length) {
        const { annotation, index } = pending[next++]!;
        track(annotation, index);
        if (next < pending.length && performance.now() - start >= RESOLVE_SLICE_MS) {
          reanchor();
          sliceTimer = view?.setTimeout(slice, 0);
          return;
        }
      }
      resolving = false;
      if (adjustBackoff) backoff = trackedPins.length > pinnedBefore ? 1 : Math.min(backoff * 2, RERESOLVE_BACKOFF_CAP_MS / RERESOLVE_MAX_WAIT_MS);
      reanchor();
      if (mutatedWhileResolving) scheduleReresolve();
    };
    slice();
  }

  function cancelPass(): void {
    if (sliceTimer !== undefined) view?.clearTimeout(sliceTimer);
    sliceTimer = undefined;
    resolving = false;
  }

  function track(annotation: Annotation, index: number): void {
    const element = resolveSelector(options.document, annotation.selector);
    if (!element) {
      unresolved.push({ annotation, index });
      return;
    }

    const marker = options.document.createElement('button');
    const pin: TrackedPin = {
      annotation,
      index,
      element,
      marker,
      hovered: false,
      focused: false,
    };
    marker.type = 'button';
    marker.className = PIN_CLASS;
    marker.setAttribute(MARKER_ATTRIBUTE, annotation.id);
    if (annotation.status === 'resolved') marker.dataset.annotationStatus = 'resolved';
    marker.setAttribute('aria-label', `Annotation ${index + 1}`);
    marker.setAttribute('aria-describedby', tooltipId(annotation));
    marker.textContent = String(index + 1);
    marker.style.cssText = MARKER_STYLE;
    marker.addEventListener('mouseenter', () => {
      pin.hovered = true;
      showTooltip(pin);
    });
    marker.addEventListener('mouseleave', (event) => {
      if (tooltip && event.relatedTarget === tooltip) return;
      pin.hovered = false;
      updateTooltip(pin);
    });
    marker.addEventListener('focus', () => {
      pin.focused = true;
      showTooltip(pin);
    });
    marker.addEventListener('blur', () => {
      pin.focused = false;
      updateTooltip(pin);
    });
    marker.addEventListener('click', () => {
      marker.classList.add(PULSE_CLASS);
      if (pin.pulseTimeout !== undefined) view?.clearTimeout(pin.pulseTimeout);
      pin.pulseTimeout = view?.setTimeout(() => {
        pin.pulseTimeout = undefined;
        marker.classList.remove(PULSE_CLASS);
      }, 500);
      options.onActivate?.(annotation);
    });
    options.container.append(marker);
    trackedPins.push(pin);
  }

  function showTooltip(pin: TrackedPin): void {
    if (destroyed) return;
    if (!tooltip) {
      tooltip = options.document.createElement('div');
      tooltip.setAttribute(TOOLTIP_ATTRIBUTE, '');
      tooltip.className = 'annotation-pin-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      // The pointer may move from the pin onto the tooltip; leaving it for anything but the pin hides it.
      tooltip.addEventListener('mouseleave', (event) => {
        if (!tooltipPin || event.relatedTarget === tooltipPin.marker) return;
        tooltipPin.hovered = false;
        updateTooltip(tooltipPin);
      });
      options.container.append(tooltip);
    }
    tooltipPin = pin;
    tooltip.id = tooltipId(pin.annotation);
    tooltip.textContent = truncateNote(pin.annotation.note);
    tooltip.hidden = false;
    const { width, height } = tooltip.getBoundingClientRect();
    const { left, top } = placeTooltip(pin.marker.getBoundingClientRect(), { width, height }, viewport());
    placeFixed(tooltip, { left, top });
  }

  function viewport(): Viewport {
    const root = options.document.documentElement;
    return { width: root.clientWidth, height: root.clientHeight };
  }

  function updateTooltip(pin: TrackedPin): void {
    if (pin.hovered || pin.focused) {
      showTooltip(pin);
    } else if (pin === tooltipPin) {
      hideTooltip();
    }
  }

  function hideTooltip(): void {
    tooltip?.remove();
    tooltip = undefined;
    tooltipPin = undefined;
  }

  function clearPulse(pin: TrackedPin): void {
    if (pin.pulseTimeout !== undefined) {
      view?.clearTimeout(pin.pulseTimeout);
      pin.pulseTimeout = undefined;
    }
    pin.marker.classList.remove(PULSE_CLASS);
  }
}

function tooltipId(annotation: Annotation): string {
  return `annotation-pin-tooltip-${annotation.id}`;
}

function truncateNote(note: string): string {
  return note.length > NOTE_PREVIEW_LENGTH
    ? `${note.slice(0, NOTE_PREVIEW_LENGTH)}…`
    : note;
}
