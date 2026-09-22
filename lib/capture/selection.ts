import { createEventBus, type EventBus } from '../ui/event-bus';
import { extractElementContext, type ElementContext } from './context';

export interface CaptureEvents {
  'element:selected': ElementContext;
  'capture:active': boolean;
}

export interface CaptureController {
  active: boolean;
  toggle(): void;
  activate(): void;
  deactivate(): void;
  destroy(): void;
}

export interface CaptureControllerOptions {
  document: Document;
  shadowHost: HTMLElement;
  panel: HTMLElement;
  bus?: EventBus<CaptureEvents>;
}

const HIGHLIGHT_ATTRIBUTE = 'data-annotation-highlight';
const HIGHLIGHT_STYLE = [
  'position: fixed',
  'z-index: 2147483646',
  'pointer-events: none',
  'border: 2px solid #2f6fed',
  'background: rgba(47, 111, 237, 0.12)',
  'box-sizing: border-box',
].join(';');

export function createCaptureController(options: CaptureControllerOptions): CaptureController {
  const bus = options.bus ?? createEventBus<CaptureEvents>();
  const highlight = options.document.createElement('div');
  highlight.setAttribute(HIGHLIGHT_ATTRIBUTE, '');
  highlight.style.cssText = HIGHLIGHT_STYLE;
  highlight.hidden = true;
  options.shadowHost.shadowRoot?.append(highlight);
  const unsubscribeContext = bus.on('element:selected', (context) => {
    renderContext(options.panel, context);
  });

  let active = false;
  let hoveredElement: Element | null = null;

  const handlePointerMove = (event: PointerEvent) => {
    if (!active || isExtensionEvent(event, options.shadowHost)) return;
    setHoveredElement(options.document.elementFromPoint(event.clientX, event.clientY));
  };

  const handleClick = (event: MouseEvent) => {
    if (!active || isExtensionEvent(event, options.shadowHost)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const element = hoveredElement ?? options.document.elementFromPoint(event.clientX, event.clientY);
    if (!element || isExtensionElement(element, options.shadowHost)) return;

    const context = extractElementContext(element);
    bus.emit('element:selected', context);
    deactivate();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!active || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    deactivate();
  };

  const activate = () => {
    if (active) return;
    active = true;
    options.document.addEventListener('pointermove', handlePointerMove, true);
    options.document.addEventListener('click', handleClick, true);
    options.document.addEventListener('keydown', handleKeyDown, true);
    bus.emit('capture:active', true);
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    hoveredElement = null;
    highlight.hidden = true;
    options.document.removeEventListener('pointermove', handlePointerMove, true);
    options.document.removeEventListener('click', handleClick, true);
    options.document.removeEventListener('keydown', handleKeyDown, true);
    bus.emit('capture:active', false);
  };

  const destroy = () => {
    deactivate();
    unsubscribeContext();
    highlight.remove();
  };

  function setHoveredElement(element: Element | null) {
    if (!element || isExtensionElement(element, options.shadowHost)) {
      hoveredElement = null;
      highlight.hidden = true;
      return;
    }

    hoveredElement = element;
    const rect = element.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  return {
    get active() {
      return active;
    },
    toggle() {
      if (active) deactivate();
      else activate();
    },
    activate,
    deactivate,
    destroy,
  };
}

function isExtensionEvent(event: Event, shadowHost: HTMLElement): boolean {
  return event.composedPath().includes(shadowHost);
}

function isExtensionElement(element: Element, shadowHost: HTMLElement): boolean {
  return element === shadowHost || shadowHost.shadowRoot?.contains(element) === true;
}

function renderContext(panel: HTMLElement, context: ElementContext): void {
  panel.replaceChildren();
  const readout = panel.ownerDocument.createElement('pre');
  readout.dataset.annotationContext = '';
  readout.textContent = JSON.stringify(context, null, 2);
  panel.append(readout);
}
