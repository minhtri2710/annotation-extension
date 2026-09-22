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
}

const BADGE_ATTRIBUTE = 'data-annotation-badge';
const MARKER_ATTRIBUTE = 'data-annotation-id';
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
  'font: inherit',
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
    for (const pin of trackedPins) pin.marker.remove();
    trackedPins = [];
    badge.textContent = String(annotations.length);

    for (const annotation of annotations) {
      const element = resolveElement(options.document, annotation.selector);
      if (!element) continue;

      const marker = options.document.createElement('button');
      marker.type = 'button';
      marker.setAttribute(MARKER_ATTRIBUTE, annotation.id);
      marker.setAttribute('aria-label', `Open annotation ${annotation.id}`);
      marker.textContent = '•';
      marker.style.cssText = MARKER_STYLE;
      marker.addEventListener('click', () => options.onActivate?.(annotation));
      options.container.append(marker);
      trackedPins.push({ annotation, element, marker });
    }

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
    for (const pin of trackedPins) pin.marker.remove();
    trackedPins = [];
    badge.remove();
  };

  return { setAnnotations, reanchor, destroy };
}

function resolveElement(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
