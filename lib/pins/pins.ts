import type { Annotation } from '../annotation';

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

interface TrackedPin {
  annotation: Annotation;
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
  badge.setAttribute('aria-label', 'Annotation count');
  options.toolbar.append(badge);

  let trackedPins: TrackedPin[] = [];
  let frame: number | undefined;
  let tooltip: HTMLDivElement | undefined;
  let destroyed = false;

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

  const observer = new MutationObserver(scheduleReanchor);
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
    badge.textContent = String(annotations.length);

    annotations.forEach((annotation, index) => {
      const element = resolveElement(options.document, annotation.selector);
      if (!element) return;

      const marker = options.document.createElement('button');
      const pin: TrackedPin = {
        annotation,
        element,
        marker,
        hovered: false,
        focused: false,
      };
      marker.type = 'button';
      marker.className = PIN_CLASS;
      marker.setAttribute(MARKER_ATTRIBUTE, annotation.id);
      marker.setAttribute('aria-label', `Annotation ${index + 1}`);
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
    });

    reanchor();
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
    for (const pin of trackedPins) {
      clearPulse(pin);
      pin.marker.remove();
    }
    trackedPins = [];
    hideTooltip();
    badge.remove();
  };

  return { setAnnotations, reanchor, destroy };

  function showTooltip(pin: TrackedPin): void {
    if (destroyed) return;
    if (!tooltip) {
      tooltip = options.document.createElement('div');
      tooltip.setAttribute(TOOLTIP_ATTRIBUTE, '');
      tooltip.className = 'annotation-pin-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      options.container.append(tooltip);
    }
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

function truncateNote(note: string): string {
  return note.length > NOTE_PREVIEW_LENGTH
    ? `${note.slice(0, NOTE_PREVIEW_LENGTH)}…`
    : note;
}

function resolveElement(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
