import { createEventBus, type EventBus } from '../ui/event-bus';
import { extractElementContext, type ElementContext } from './context';
import { isShadowRoot } from './selector';
import { createLiveRegion } from '../ui/shell';

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
  /** Polite live region announcing each capture target change and frame refusals. */
  live: HTMLElement;
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
const KEYBOARD_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']);
const NON_RENDERED_TAGS = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta']);
const FRAME_MESSAGE = "Content inside frames can't be annotated.";
const INTERCEPTED_EVENTS = ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown'] as const;

type PageEventRoute = (event: Event) => void;
const hubs = new WeakMap<Window, { routes: Set<PageEventRoute>; listener: (event: Event) => void }>();

/**
 * Registers, once per window, the capture-phase listeners that must run before the page's own, so a page
 * that stops propagation at window capture cannot disable capture. The content script calls this first at
 * document_start and releases it when its context is invalidated; controllers route through the same set.
 * With no route (capture idle) a listener does nothing beyond one size check.
 */
export function interceptPageEvents(win: Window): Set<PageEventRoute> {
  const existing = hubs.get(win);
  if (existing) return existing.routes;
  const routes = new Set<PageEventRoute>();
  const listener = (event: Event) => {
    if (routes.size === 0) return;
    for (const route of routes) route(event);
  };
  hubs.set(win, { routes, listener });
  for (const type of INTERCEPTED_EVENTS) win.addEventListener(type, listener, true);
  return routes;
}

/** Removes the window's capture-phase listeners and drops its routes. */
export function releasePageEvents(win: Window): void {
  const hub = hubs.get(win);
  if (!hub) return;
  hubs.delete(win);
  hub.routes.clear();
  for (const type of INTERCEPTED_EVENTS) win.removeEventListener(type, hub.listener, true);
}

/** The CSS zoom an element inherits (from the page's html or body); 1 where the engine has no CSS zoom. */
export function cssZoom(element: Element): number {
  return element.currentCSSZoom ?? 1;
}

/**
 * Writes client-rect px into a fixed overlay box. The top-layer host inherits the page's zoom, which scales
 * every px written to the box, while client rects are already zoomed; dividing by the box's zoom cancels it.
 * The box must be rendered (not hidden) when this runs, or its zoom reads as 1.
 */
export function placeFixed(element: HTMLElement, box: Partial<Record<'left' | 'top' | 'width' | 'height', number>>): void {
  const zoom = cssZoom(element);
  for (const [property, value] of Object.entries(box)) element.style.setProperty(property, `${value / zoom}px`);
}

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
  const live = createLiveRegion(options.document).element;
  const view = options.document.defaultView;
  const routes = view ? interceptPageEvents(view) : undefined;
  let active = false;
  let swallowing = false;
  let hoveredElement: Element | null = null;
  let retrace: Element[] = [];
  let gestureTimer: ReturnType<typeof setTimeout> | undefined;
  let followFrame: number | undefined;

  const handlePointerMove = (event: PointerEvent) => {
    if (!active || isExtensionEvent(event, options.shadowHost)) return;
    releaseFrameFocus();
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

  // Every intercepted event while capture is active or a committed gesture is being swallowed.
  const route = (event: Event) => {
    switch (event.type) {
      case 'pointermove':
        handlePointerMove(event as PointerEvent);
        return;
      case 'pointerdown':
        if (swallowing && !active) stopGestureSwallow();
        handlePointerDown(event as PointerEvent);
        return;
      case 'keydown':
        handleKeyDown(event as KeyboardEvent);
        return;
      case 'click':
        if (active && isExtensionEvent(event, options.shadowHost)) {
          redirectOverlayClick(event as MouseEvent);
          return;
        }
    }
    if (swallowing) handleGestureEvent(event);
  };

  // A page can stop a click at window capture before it reaches the overlay. The click is taken here and
  // re-sent inside the shadow root, uncomposed, so the page never sees it and the overlay control still acts.
  function redirectOverlayClick(event: MouseEvent) {
    const target = event.composedPath()[0];
    if (!isElement(target)) return;
    swallow(event);
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: false,
      detail: event.detail,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    }));
  }

  function syncRoute() {
    if (active || swallowing) routes?.add(route);
    else routes?.delete(route);
  }

  // A click inside a frame reaches the frame's document, not this one; the top window only sees its blur.
  // Firefox moves activeElement to the frame after blur, so it is read in the next task on every engine.
  const handleWindowBlur = () => {
    view?.setTimeout(() => {
      if (active && options.document.activeElement?.localName === 'iframe') announce(FRAME_MESSAGE);
    }, 0);
  };

  // The top window gets no event for a click into a frame that already holds focus. Moving the pointer
  // back over the page returns focus to it, so the next click into a frame blurs the window again.
  function releaseFrameFocus() {
    const focused = options.document.activeElement;
    if (focused?.localName === 'iframe') (focused as HTMLIFrameElement).blur();
  }

  function announce(text: string) {
    live.textContent = text;
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      deactivate();
      return;
    }
    if (!KEYBOARD_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    // The first key with nothing highlighted only sets the starting point.
    if (!hoveredElement) {
      moveTo(startElement());
      return;
    }

    if (event.key === 'ArrowUp') {
      const parent = parentOf(hoveredElement, options.document);
      if (parent && isSelectable(parent)) {
        retrace.push(hoveredElement);
        moveTo(parent);
      }
    } else if (event.key === 'ArrowDown') {
      moveTo(retrace.pop() ?? firstChildOf(hoveredElement));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const sibling = siblingOf(hoveredElement, event.key === 'ArrowRight');
      if (sibling) {
        retrace = [];
        moveTo(sibling);
      }
    } else {
      commit(hoveredElement);
    }
  };

  function startElement(): Element | null {
    const view = options.document.defaultView;
    const x = (view?.innerWidth ?? 0) / 2;
    const y = (view?.innerHeight ?? 0) / 2;
    let element = options.document.elementsFromPoint(x, y).find((hit) => !isExtensionElement(hit, options.shadowHost));
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    if (element && isWalkable(element)) return element;
    return [...options.document.body.children].find(isWalkable) ?? null;
  }

  function siblingOf(element: Element, next: boolean): Element | null {
    let sibling = next ? element.nextElementSibling : element.previousElementSibling;
    while (sibling && !isWalkable(sibling)) sibling = next ? sibling.nextElementSibling : sibling.previousElementSibling;
    return sibling;
  }

  // An open shadow root's content comes before light-DOM children; a closed root reads as null.
  function firstChildOf(element: Element): Element | null {
    const inShadow = element.shadowRoot ? [...element.shadowRoot.children].find(isWalkable) : undefined;
    return inShadow ?? [...element.children].find(isWalkable) ?? null;
  }

  function isWalkable(element: Element): boolean {
    return isSelectable(element) && !NON_RENDERED_TAGS.has(element.localName) && element.getClientRects().length > 0;
  }

  function isSelectable(element: Element): boolean {
    const document = options.document;
    return (
      element !== document.documentElement &&
      element !== document.head &&
      element !== document.body &&
      !isExtensionElement(element, options.shadowHost)
    );
  }

  // A keyboard move with no target is a no-op.
  function moveTo(element: Element | null | undefined) {
    if (!element || !isSelectable(element)) return;
    const reduce = options.document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView(reduce ? { block: 'nearest', behavior: 'instant' } : { block: 'nearest' });
    setHoveredElement(element);
  }

  function commit(element: Element) {
    const context = extractElementContext(element);
    bus.emit('element:selected', context);
    deactivate();
  }

  function startGestureSwallow() {
    stopGestureSwallow();
    swallowing = true;
    syncRoute();
    gestureTimer = setTimeout(stopGestureSwallow, GESTURE_TIMEOUT_MS);
  }

  function stopGestureSwallow() {
    swallowing = false;
    syncRoute();
    clearTimeout(gestureTimer);
    gestureTimer = undefined;
  }

  const activate = () => {
    if (active) return;
    active = true;
    stopGestureSwallow();
    options.document.addEventListener('scroll', scheduleFollow, { capture: true, passive: true });
    view?.addEventListener('resize', scheduleFollow, { passive: true });
    view?.addEventListener('blur', handleWindowBlur);
    bus.emit('capture:active', true);
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    hoveredElement = null;
    retrace = [];
    highlight.hidden = true;
    label.hidden = true;
    announce('');
    syncRoute();
    options.document.removeEventListener('scroll', scheduleFollow, true);
    view?.removeEventListener('resize', scheduleFollow);
    view?.removeEventListener('blur', handleWindowBlur);
    if (followFrame !== undefined) options.document.defaultView?.cancelAnimationFrame(followFrame);
    followFrame = undefined;
    bus.emit('capture:active', false);
  };

  const destroy = () => {
    deactivate();
    stopGestureSwallow();
    highlight.remove();
    label.remove();
    live.remove();
  };

  // Keeps the highlight on the element through smooth scrolls, nested scrollers and resizes.
  function scheduleFollow() {
    if (!hoveredElement || followFrame !== undefined) return;
    followFrame = options.document.defaultView?.requestAnimationFrame(() => {
      followFrame = undefined;
      if (!active) return;
      // A hovered element removed since the last move reads as hovering nothing, as a pointer move off it would.
      if (!hoveredElement?.isConnected) retrace = [];
      setHoveredElement(hoveredElement?.isConnected ? hoveredElement : null);
    });
  }

  function setHoveredElement(element: Element | null) {
    if (!element || isExtensionElement(element, options.shadowHost)) {
      hoveredElement = null;
      highlight.hidden = true;
      label.hidden = true;
      return;
    }

    const changed = element !== hoveredElement;
    hoveredElement = element;
    const rect = element.getBoundingClientRect();
    highlight.hidden = false;
    placeFixed(highlight, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    label.hidden = false;
    label.textContent = describeElement(element);
    const labelHeight = LABEL_HEIGHT * cssZoom(label);
    placeFixed(label, { left: rect.left, top: rect.top < labelHeight ? rect.top : rect.top - labelHeight });
    if (changed) announce(label.textContent);
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
    live,
  };
}

function swallow(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

// composedPath()[0] is the deepest element the page can see: inside open shadow roots it is the
// deep target; a closed root retargets it to the host.
function resolveTarget(event: MouseEvent, document: Document): Element | null {
  const deep = event.composedPath()[0];
  // nodeType, not instanceof: targets from another realm (an iframe, Firefox Xray wrappers) fail instanceof.
  return isElement(deep) ? deep : document.elementFromPoint(event.clientX, event.clientY);
}

function isElement(target: EventTarget | undefined): target is Element {
  return (target as Node | undefined)?.nodeType === Node.ELEMENT_NODE;
}

function parentOf(element: Element, document: Document): Element | null {
  const root = element.getRootNode();
  const parent = element.parentElement ?? (isShadowRoot(root) ? root.host : null);
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
