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
  bus?: EventBus<CaptureEvents>;
}

const HIGHLIGHT_ATTRIBUTE = 'data-annotation-highlight';
const LABEL_ATTRIBUTE = 'data-annotation-highlight-label';
const HIGHLIGHT_STYLE = [
  'position: fixed',
  'z-index: 2147483646',
  'pointer-events: none',
  'border: 2px solid #2f6fed',
  'background: rgba(47, 111, 237, 0.12)',
  'box-sizing: border-box',
].join(';');
const LABEL_HEIGHT = 24;
const LABEL_MAX_LENGTH = 60;
const LABEL_STYLE = [
  'position: fixed',
  'z-index: 2147483647',
  'pointer-events: none',
  `height: ${LABEL_HEIGHT}px`,
  `line-height: ${LABEL_HEIGHT}px`,
  'padding: 0 6px',
  'box-sizing: border-box',
  'background: #2f6fed',
  'color: #fff',
  'font: 12px/24px ui-monospace, monospace',
  'white-space: nowrap',
].join(';');
// Upper bound for a committed gesture's trailing events (pointerup/mouseup/click) when no click ever arrives.
const GESTURE_TIMEOUT_MS = 1000;
const GESTURE_EVENTS = ['mousedown', 'pointerup', 'mouseup', 'click'] as const;

export function createCaptureController(options: CaptureControllerOptions): CaptureController {
  const bus = options.bus ?? createEventBus<CaptureEvents>();
  const highlight = options.document.createElement('div');
  highlight.setAttribute(HIGHLIGHT_ATTRIBUTE, '');
  highlight.style.cssText = HIGHLIGHT_STYLE;
  highlight.hidden = true;
  const label = options.document.createElement('div');
  label.setAttribute(LABEL_ATTRIBUTE, '');
  label.style.cssText = LABEL_STYLE;
  label.hidden = true;
  options.shadowHost.shadowRoot?.append(highlight, label);
  let active = false;
  let hoveredElement: Element | null = null;
  let retrace: Element[] = [];
  let gestureTimer: ReturnType<typeof setTimeout> | undefined;

  const handlePointerMove = (event: PointerEvent) => {
    if (!active || isExtensionEvent(event, options.shadowHost)) return;
    const element = resolveTarget(event, options.document);
    if (element !== hoveredElement) retrace = [];
    setHoveredElement(element);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!active || event.button !== 0 || isExtensionEvent(event, options.shadowHost)) return;
    swallow(event);
    const element = resolveTarget(event, options.document);
    if (!element || isExtensionElement(element, options.shadowHost)) return;
    // The rest of this gesture must not reach the page; commit's deactivate() leaves the swallower installed.
    startGestureSwallow();
    commit(element);
  };

  // Gesture swallower: installed on a committed pointerdown, removed by the trailing click,
  // by the next pointerdown (new gesture), by GESTURE_TIMEOUT_MS, or by destroy().
  const handleGestureEvent = (event: Event) => {
    if (isExtensionEvent(event, options.shadowHost)) return;
    swallow(event);
    if (event.type === 'click') stopGestureSwallow();
  };

  const handleNextPointerDown = () => {
    if (!active) stopGestureSwallow();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      deactivate();
      return;
    }
    if (!hoveredElement) return;

    if (event.key === 'ArrowUp') {
      const parent = parentOf(hoveredElement, options.document);
      if (parent && !isExtensionElement(parent, options.shadowHost)) {
        retrace.push(hoveredElement);
        setHoveredElement(parent);
      }
    } else if (event.key === 'ArrowDown') {
      const previous = retrace.pop();
      if (previous) setHoveredElement(previous);
    } else if (event.key === 'Enter') {
      commit(hoveredElement);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  function commit(element: Element) {
    const context = extractElementContext(element);
    bus.emit('element:selected', context);
    deactivate();
  }

  function startGestureSwallow() {
    stopGestureSwallow();
    for (const type of GESTURE_EVENTS) options.document.addEventListener(type, handleGestureEvent, true);
    options.document.addEventListener('pointerdown', handleNextPointerDown, true);
    gestureTimer = setTimeout(stopGestureSwallow, GESTURE_TIMEOUT_MS);
  }

  function stopGestureSwallow() {
    for (const type of GESTURE_EVENTS) options.document.removeEventListener(type, handleGestureEvent, true);
    options.document.removeEventListener('pointerdown', handleNextPointerDown, true);
    clearTimeout(gestureTimer);
    gestureTimer = undefined;
  }

  const activate = () => {
    if (active) return;
    active = true;
    stopGestureSwallow();
    options.document.addEventListener('pointermove', handlePointerMove, true);
    options.document.addEventListener('pointerdown', handlePointerDown, true);
    options.document.addEventListener('keydown', handleKeyDown, true);
    bus.emit('capture:active', true);
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    hoveredElement = null;
    retrace = [];
    highlight.hidden = true;
    label.hidden = true;
    options.document.removeEventListener('pointermove', handlePointerMove, true);
    options.document.removeEventListener('pointerdown', handlePointerDown, true);
    options.document.removeEventListener('keydown', handleKeyDown, true);
    bus.emit('capture:active', false);
  };

  const destroy = () => {
    deactivate();
    stopGestureSwallow();
    highlight.remove();
    label.remove();
  };

  function setHoveredElement(element: Element | null) {
    if (!element || isExtensionElement(element, options.shadowHost)) {
      hoveredElement = null;
      highlight.hidden = true;
      label.hidden = true;
      return;
    }

    hoveredElement = element;
    const rect = element.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    label.hidden = false;
    label.textContent = describeElement(element);
    label.style.left = `${rect.left}px`;
    label.style.top = `${rect.top < LABEL_HEIGHT ? rect.top : rect.top - LABEL_HEIGHT}px`;
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

function swallow(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

// Highlight and commit the light-DOM element: selectors are document-scoped, so a target inside an
// open shadow root resolves to its outermost host (shadow-aware selectors: backlog qa7b-shadow-select).
function resolveTarget(event: MouseEvent, document: Document): Element | null {
  const deep = event.composedPath()[0];
  let element = deep instanceof Element ? deep : document.elementFromPoint(event.clientX, event.clientY);
  for (let root = element?.getRootNode(); element && root instanceof ShadowRoot; root = element.getRootNode()) {
    element = root.host;
  }
  return element;
}

function parentOf(element: Element, document: Document): Element | null {
  const parent = element.parentElement;
  if (!parent || parent === document.documentElement || parent === document.body) return null;
  return parent;
}

function describeElement(element: Element): string {
  let text = element.tagName.toLowerCase();
  if (element.id) text += `#${element.id}`;
  for (const name of [...element.classList].slice(0, 2)) text += `.${name}`;
  return text.length > LABEL_MAX_LENGTH ? `${text.slice(0, LABEL_MAX_LENGTH - 1)}…` : text;
}

function isExtensionEvent(event: Event, shadowHost: HTMLElement): boolean {
  return event.composedPath().includes(shadowHost);
}

function isExtensionElement(element: Element, shadowHost: HTMLElement): boolean {
  return element === shadowHost || shadowHost.shadowRoot?.contains(element) === true;
}
