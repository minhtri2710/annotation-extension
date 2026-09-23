// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementContext } from './context';
import { createCaptureController, type CaptureController } from './selection';
import { createEventBus } from '../ui/event-bus';
import type { CaptureEvents } from './selection';

let host: HTMLElement;
let controller: CaptureController;
let selected: ElementContext[];
let pageEvents: string[];

function rect(top: number, left = 10, width = 100, height = 40): DOMRect {
  return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function stubRect(element: Element, top: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(top));
}

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}) {
  const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

function mouse(type: string, target: EventTarget) {
  const event = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0 });
  target.dispatchEvent(event);
  return event;
}

function key(name: string) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

function highlight() {
  return host.shadowRoot!.querySelector('[data-annotation-highlight]') as HTMLElement;
}

function label() {
  return host.shadowRoot!.querySelector('[data-annotation-highlight-label]') as HTMLElement;
}

const PAGE_TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
const recordPage = (event: Event) => pageEvents.push(event.type);

beforeEach(() => {
  document.body.innerHTML =
    '<main id="outer" class="wrap"><section id="mid"><button id="target" class="primary big extra">Go</button></section></main>';
  host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.append(host);
  selected = [];
  pageEvents = [];
  for (const type of PAGE_TYPES) document.body.addEventListener(type, recordPage);
  const bus = createEventBus<CaptureEvents>();
  bus.on('element:selected', (context) => selected.push(context));
  controller = createCaptureController({ document, shadowHost: host, bus });
});

afterEach(() => {
  controller.destroy();
  for (const type of PAGE_TYPES) document.body.removeEventListener(type, recordPage);
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('commit on pointerdown', () => {
  it('commits on primary pointerdown and swallows the whole gesture from the page', () => {
    const target = document.querySelector('#target')!;
    controller.activate();

    const down = pointer('pointerdown', target);
    expect(down.defaultPrevented).toBe(true);
    expect(selected.map((context) => context.id)).toEqual(['target']);
    expect(controller.active).toBe(false);

    mouse('mousedown', target);
    pointer('pointerup', target);
    mouse('mouseup', target);
    const click = mouse('click', target);

    expect(click.defaultPrevented).toBe(true);
    expect(pageEvents).toEqual([]);
  });

  it('releases the gesture swallower after the trailing click', () => {
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointerdown', target);
    pointer('pointerup', target);
    mouse('click', target);

    mouse('click', target);
    pointer('pointerdown', target);
    expect(pageEvents).toEqual(['click', 'pointerdown']);
  });

  it('releases the gesture swallower on a timeout when no click arrives', () => {
    vi.useFakeTimers();
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointerdown', target);
    vi.runAllTimers();

    mouse('click', target);
    expect(pageEvents).toEqual(['click']);
  });

  it('ignores non-primary buttons', () => {
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointerdown', target, { button: 2 });
    expect(selected).toEqual([]);
    expect(controller.active).toBe(true);
    expect(pageEvents).toEqual(['pointerdown']);
  });

  it('never swallows events inside the extension shadow host', () => {
    const button = document.createElement('button');
    host.shadowRoot!.append(button);
    const inside: string[] = [];
    for (const type of PAGE_TYPES) button.addEventListener(type, (event) => inside.push(event.type));
    controller.activate();

    pointer('pointerdown', button);
    mouse('click', button);
    expect(inside).toEqual(['pointerdown', 'click']);
    expect(selected).toEqual([]);
    expect(controller.active).toBe(true);
  });

  it('destroy removes gesture listeners and nodes', () => {
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointerdown', target);
    controller.destroy();

    mouse('click', target);
    expect(pageEvents).toEqual(['click']);
    expect(host.shadowRoot!.childElementCount).toBe(0);
  });
});

describe('deep target', () => {
  function nested() {
    const outer = document.createElement('x-card');
    outer.id = 'card';
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('x-chip');
    outerRoot.append(inner);
    const innerRoot = inner.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<p id="para"><span id="deep" class="inner">deep</span></p>';
    document.body.append(outer);
    return { outer, inner, para: innerRoot.querySelector('#para')!, deep: innerRoot.querySelector('#deep')! };
  }

  it('highlights, labels and commits the deep element for a pointer inside nested open shadow roots', () => {
    const { outer, deep } = nested();
    stubRect(outer, 100);
    stubRect(deep, 300);
    controller.activate();

    pointer('pointermove', deep);
    expect(highlight().hidden).toBe(false);
    expect(highlight().style.top).toBe('300px');
    expect(label().textContent).toBe('span#deep.inner');

    pointer('pointerdown', deep);
    expect(selected.map((context) => context.id)).toEqual(['deep']);
    expect(selected[0]!.selector).toBe('#card >>> x-chip >>> #deep');
  });

  it('ArrowUp crosses shadow boundaries to hosts and ArrowDown retraces back', () => {
    const { outer, inner, para, deep } = nested();
    for (const element of [outer, inner, para, deep]) stubRect(element, 100);
    controller.activate();
    pointer('pointermove', deep);

    key('ArrowUp');
    expect(label().textContent).toBe('p#para');
    key('ArrowUp');
    expect(label().textContent).toBe('x-chip');
    key('ArrowUp');
    expect(label().textContent).toBe('x-card#card');
    key('ArrowUp');
    expect(label().textContent).toBe('x-card#card');

    key('ArrowDown');
    expect(label().textContent).toBe('x-chip');
    key('ArrowDown');
    expect(label().textContent).toBe('p#para');
    key('ArrowDown');
    expect(label().textContent).toBe('span#deep.inner');
    key('Enter');
    expect(selected.map((context) => context.id)).toEqual(['deep']);
  });

  it('commits the host for a pointer inside a closed shadow root', () => {
    const closedHost = document.createElement('x-sealed');
    closedHost.id = 'sealed';
    const root = closedHost.attachShadow({ mode: 'closed' });
    root.innerHTML = '<span id="hidden">x</span>';
    document.body.append(closedHost);
    stubRect(closedHost, 100);
    controller.activate();

    // happy-dom does not retarget composedPath() at a closed root; a browser presents the host as
    // composedPath()[0] to a document listener, so the event is dispatched at the host here.
    pointer('pointermove', closedHost);
    expect(label().textContent).toBe('x-sealed#sealed');
    pointer('pointerdown', closedHost);
    expect(selected.map((context) => context.id)).toEqual(['sealed']);
  });

  it('still never highlights or commits the extension UI', () => {
    const button = document.createElement('button');
    host.shadowRoot!.append(button);
    stubRect(button, 100);
    controller.activate();

    pointer('pointermove', button);
    expect(highlight().hidden).toBe(true);
    pointer('pointerdown', button);
    expect(selected).toEqual([]);
    expect(controller.active).toBe(true);
  });
});

describe('hover label', () => {
  it('shows tag, id and at most two classes above the box', () => {
    const target = document.querySelector('#target')!;
    stubRect(target, 100);
    controller.activate();

    pointer('pointermove', target);
    expect(label().hidden).toBe(false);
    expect(label().textContent).toBe('button#target.primary.big');
    expect(label().style.pointerEvents).toBe('none');
    expect(label().style.top).toBe('76px');
  });

  it('flips inside the box near the viewport top', () => {
    const target = document.querySelector('#target')!;
    stubRect(target, 10);
    controller.activate();

    pointer('pointermove', target);
    expect(label().style.top).toBe('10px');
  });

  it('truncates long labels with an ellipsis', () => {
    const target = document.querySelector('#target')!;
    target.id = 'x'.repeat(80);
    stubRect(target, 100);
    controller.activate();

    pointer('pointermove', target);
    expect(label().textContent).toHaveLength(60);
    expect(label().textContent!.endsWith('…')).toBe(true);
  });

  it('hides with the highlight on deactivate', () => {
    const target = document.querySelector('#target')!;
    stubRect(target, 100);
    controller.activate();
    pointer('pointermove', target);
    controller.deactivate();
    expect(highlight().hidden).toBe(true);
    expect(label().hidden).toBe(true);
  });
});

describe('keyboard navigation', () => {
  beforeEach(() => {
    for (const element of document.querySelectorAll('*')) stubRect(element, 100);
  });

  it('ArrowUp walks to parents, stops below body, ArrowDown retraces', () => {
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointermove', target);

    expect(key('ArrowUp').defaultPrevented).toBe(true);
    expect(label().textContent).toBe('section#mid');
    key('ArrowUp');
    expect(label().textContent).toBe('main#outer.wrap');
    key('ArrowUp');
    expect(label().textContent).toBe('main#outer.wrap');

    key('ArrowDown');
    expect(label().textContent).toBe('section#mid');
    key('ArrowDown');
    expect(label().textContent).toBe('button#target.primary.big');
  });

  it('Enter commits the highlighted element', () => {
    const target = document.querySelector('#target')!;
    controller.activate();
    pointer('pointermove', target);
    key('ArrowUp');

    expect(key('Enter').defaultPrevented).toBe(true);
    expect(selected.map((context) => context.id)).toEqual(['mid']);
    expect(controller.active).toBe(false);
  });

  it('pointer move to a new element clears the retrace stack', () => {
    const target = document.querySelector('#target')!;
    const outer = document.querySelector('#outer')!;
    controller.activate();
    pointer('pointermove', target);
    key('ArrowUp');
    pointer('pointermove', outer);

    key('ArrowDown');
    expect(label().textContent).toBe('section#mid');
  });

  it('Escape still deactivates', () => {
    controller.activate();
    key('Escape');
    expect(controller.active).toBe(false);
    expect(selected).toEqual([]);
  });
});

describe('keyboard-only capture', () => {
  let pointHits: Element[];
  let scrolled: Array<{ element: Element; options: unknown }>;

  beforeEach(() => {
    document.body.insertAdjacentHTML('afterbegin', '<p id="first">a</p>');
    document.querySelector('#outer')!.insertAdjacentHTML('beforeend', '<aside id="side">b</aside>');
    for (const element of document.querySelectorAll('*')) stubRect(element, 100);
    pointHits = [];
    scrolled = [];
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => pointHits),
    });
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element, options) {
      scrolled.push({ element: this, options });
    });
  });

  afterEach(() => {
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  it('Enter with nothing highlighted only highlights the start point and never commits', () => {
    controller.activate();
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(selected).toEqual([]);
    expect(controller.active).toBe(true);
    expect(label().textContent).toBe('p#first');
  });

  it('starts at the element under the viewport centre, skipping the extension host', () => {
    const mid = document.querySelector('#mid')!;
    pointHits = [host, mid, document.body, document.documentElement];
    controller.activate();

    expect(key('ArrowUp').defaultPrevented).toBe(true);
    expect(document.elementsFromPoint).toHaveBeenCalledWith(window.innerWidth / 2, window.innerHeight / 2);
    expect(label().textContent).toBe('section#mid');
    expect(highlight().hidden).toBe(false);
  });

  it('resolves the viewport centre into open shadow roots', () => {
    const card = document.createElement('x-card');
    const root = card.attachShadow({ mode: 'open' });
    root.innerHTML = '<span id="inside">x</span>';
    document.body.append(card);
    const inside = root.querySelector('#inside')!;
    stubRect(card, 100);
    stubRect(inside, 100);
    Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => inside });
    pointHits = [card];
    controller.activate();

    key('ArrowDown');
    expect(label().textContent).toBe('span#inside');
  });

  it('falls back to the first element child of body when the centre hits nothing selectable', () => {
    pointHits = [host, document.body, document.documentElement];
    controller.activate();

    key('ArrowRight');
    expect(label().textContent).toBe('p#first');
  });

  it('ArrowDown goes to the first child, ArrowLeft and ArrowRight walk siblings and clear the retrace', () => {
    pointHits = [document.querySelector('#outer')!];
    controller.activate();
    key('ArrowLeft');
    expect(label().textContent).toBe('main#outer.wrap');

    key('ArrowDown');
    expect(label().textContent).toBe('section#mid');
    key('ArrowRight');
    expect(label().textContent).toBe('aside#side');
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(label().textContent).toBe('aside#side');
    key('ArrowLeft');
    expect(label().textContent).toBe('section#mid');
    key('ArrowLeft');
    expect(label().textContent).toBe('section#mid');

    key('ArrowRight');
    key('ArrowUp');
    key('ArrowLeft');
    expect(label().textContent).toBe('p#first');
    key('ArrowRight');
    expect(label().textContent).toBe('main#outer.wrap');
    key('ArrowDown');
    expect(label().textContent).toBe('section#mid');
    key('ArrowDown');
    expect(label().textContent).toBe('button#target.primary.big');
    key('ArrowDown');
    expect(label().textContent).toBe('button#target.primary.big');
  });

  it('never moves onto the extension host or into its shadow root', () => {
    host.shadowRoot!.append(document.createElement('button'));
    pointHits = [document.querySelector('#outer')!];
    controller.activate();
    key('ArrowDown');

    key('ArrowRight');
    expect(label().textContent).toBe('main#outer.wrap');
    key('ArrowRight');
    expect(label().textContent).toBe('main#outer.wrap');
    key('ArrowUp');
    expect(label().textContent).toBe('main#outer.wrap');
    expect(highlight().hidden).toBe(false);
  });

  it('scrolls each keyboard move into view, instantly under reduced motion', () => {
    const target = document.querySelector('#target')!;
    pointHits = [target];
    controller.activate();
    key('ArrowDown');
    expect(scrolled).toEqual([{ element: target, options: { block: 'nearest' } }]);

    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList,
    );
    key('ArrowUp');
    expect(scrolled[1]).toEqual({ element: document.querySelector('#mid'), options: { block: 'nearest', behavior: 'instant' } });
  });

  it('a keyboard-only flow from activation to Enter commits the chosen element', () => {
    pointHits = [document.querySelector('#mid')!];
    controller.activate();

    key('ArrowDown');
    key('ArrowDown');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(selected.map((context) => context.id)).toEqual(['target']);
    expect(controller.active).toBe(false);
  });

  it('a pointer move after keyboard use takes over', () => {
    pointHits = [document.querySelector('#mid')!];
    controller.activate();
    key('ArrowDown');
    pointer('pointermove', document.querySelector('#first')!);
    expect(label().textContent).toBe('p#first');
  });
});
