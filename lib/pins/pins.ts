import type { Annotation } from '../annotation';
import { resolveSelector } from '../capture/selector';

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
export const RERESOLVE_DEBOUNCE_MS = 250;
export const RERESOLVE_MAX_WAIT_MS = 1000;
export const RERESOLVE_BACKOFF_CAP_MS = 30_000;
// Same budget as the lint engine's SCAN_SLICE_MS.
export const RESOLVE_SLICE_MS = 12;
const MARKER_STYLE = [
  'position: fixed',
  'z-index: 2147483647',
  'width: 18px',
  'height: 18px',
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
  let destroyed = false;
  // Doubles after each re-resolve pass that pins nothing new; 1 again once one does or the set changes.
  let backoff = 1;
  let sliceTimer: number | undefined;
  let resolving = false;
  let mutatedWhileResolving = false;

  const reanchor = () => {
    if (destroyed) return;

    for (const pin of trackedPins) {
      if (!pin.element.isConnected) {
        pin.marker.hidden = true;
        continue;
      }

      const rect = pin.element.getBoundingClientRect();
      pin.marker.hidden = false;
      pin.marker.style.left = `${rect.left}px`;
      pin.marker.style.top = `${rect.top}px`;
    }
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
      if (tooltip && (pin.hovered || pin.focused)) hideTooltip();
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
    marker.addEventListener('mouseleave', () => {
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
      options.container.append(tooltip);
    }
    tooltip.id = tooltipId(pin.annotation);
    tooltip.textContent = truncateNote(pin.annotation.note);
    const rect = pin.marker.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 8}px`;
    tooltip.style.top = `${rect.top}px`;
    tooltip.hidden = false;
  }

  function updateTooltip(pin: TrackedPin): void {
    if (pin.hovered || pin.focused) {
      showTooltip(pin);
    } else {
      hideTooltip();
    }
  }

  function hideTooltip(): void {
    tooltip?.remove();
    tooltip = undefined;
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
