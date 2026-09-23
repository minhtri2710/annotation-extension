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
  it('highlights, labels and commits the outermost light-DOM host for a pointer inside nested open shadow roots', () => {
    const outer = document.createElement('x-card');
    outer.id = 'card';
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('x-chip');
    outerRoot.append(inner);
    const innerRoot = inner.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<span id="deep" class="inner">deep</span>';
    document.body.append(outer);
    const deep = innerRoot.querySelector('#deep')!;
    stubRect(outer, 100);
    stubRect(deep, 300);
    controller.activate();

    pointer('pointermove', deep);
    expect(highlight().hidden).toBe(false);
    expect(highlight().style.top).toBe('100px');
    expect(label().textContent).toBe('x-card#card');

    pointer('pointerdown', deep);
    expect(selected.map((context) => context.id)).toEqual(['card']);
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
    expect(label().textContent).toBe('main#outer.wrap');
  });

  it('Escape still deactivates', () => {
    controller.activate();
    key('Escape');
    expect(controller.active).toBe(false);
    expect(selected).toEqual([]);
  });

  it('leaves keys alone when nothing is highlighted', () => {
    controller.activate();
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(selected).toEqual([]);
  });
});
