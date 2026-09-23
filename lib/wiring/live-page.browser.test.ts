import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createCaptureController, interceptPageEvents, type CaptureController, type CaptureEvents } from '../capture/selection';
import { createPinsController, type PinsController } from '../pins/pins';
import { createEventBus } from '../ui/event-bus';
import { watchRoute } from './route-watch';

let host: HTMLElement;
let target: HTMLElement;
let controller: CaptureController | undefined;
let pins: PinsController | undefined;
let selected: ElementContext[];

// The overlay host as the content script mounts it: a shadow host raised into the top layer.
function mountHost() {
  host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.append(host);
  host.popover = 'manual';
  host.showPopover();
}

function startCapture() {
  selected = [];
  const bus = createEventBus<CaptureEvents>();
  bus.on('element:selected', (context) => selected.push(context));
  controller = createCaptureController({ document, shadowHost: host, bus });
  controller.activate();
}

function hover(element: Element) {
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
}

function annotation(selector: string): Annotation {
  const context = {
    selector,
    tagName: 'P',
    id: '',
    classList: [],
    text: '',
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    url: location.href,
    viewport: { width: 0, height: 0 },
    sourcePath: null,
  };
  return {
    id: 'zoomed',
    pageUrl: location.href,
    note: 'zoomed',
    selector,
    elementContext: context,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
  };
}

function expectWithin(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
}

beforeEach(() => {
  document.body.style.margin = '0';
  target = document.createElement('p');
  target.id = 'zoom-target';
  target.style.cssText = 'margin: 60px 0 0 70px; width: 150px; height: 20px';
  document.body.append(target);
  mountHost();
});

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  pins?.destroy();
  pins = undefined;
  host.remove();
  target.remove();
  document.documentElement.style.zoom = '';
  document.body.style.zoom = '';
});

describe.each([
  ['html', () => document.documentElement],
  ['body', () => document.body],
])('page zoom on %s (real browser)', (_name, zoomed) => {
  beforeEach(() => {
    zoomed().style.zoom = '1.5';
  });

  it('the capture highlight covers its element within 2 px', () => {
    startCapture();
    hover(target);

    const box = host.shadowRoot!.querySelector<HTMLElement>('[data-annotation-highlight]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expect(expected.width).toBeCloseTo(225, 0);
    expectWithin(box.left, expected.left);
    expectWithin(box.top, expected.top);
    expectWithin(box.width, expected.width);
    expectWithin(box.height, expected.height);
  });

  it("the highlight label sits on the element's top edge", () => {
    startCapture();
    hover(target);

    const label = host.shadowRoot!.querySelector<HTMLElement>('[data-annotation-highlight-label]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expectWithin(label.left, expected.left);
    expectWithin(label.bottom, expected.top);
  });

  it("a pin is centred on its element's top-left corner within 2 px", () => {
    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    host.shadowRoot!.append(container, toolbar);
    pins = createPinsController({ document, container, toolbar });
    pins.setAnnotations([annotation('#zoom-target')]);

    const marker = container.querySelector<HTMLElement>('[data-annotation-id]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expectWithin(marker.left + marker.width / 2, expected.left);
    expectWithin(marker.top + marker.height / 2, expected.top);
  });
});

describe('route changes without a head change (real browser)', () => {
  const start = location.href;

  afterEach(() => {
    history.replaceState(null, '', start);
  });

  it.each(['pushState', 'replaceState'] as const)('reports a %s route within one poll, once', async (method) => {
    const seen: string[] = [];
    const stop = watchRoute(window, (url) => seen.push(url));
    try {
      history[method](null, '', '/live-page-route');
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } finally {
      stop();
    }

    expect(seen).toEqual([`${location.origin}/live-page-route`]);
  });
});

describe('clicks inside frames (real browser)', () => {
  it('announces that frame content cannot be annotated, stays active and saves nothing', async () => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button style="width: 300px; height: 150px">inner</button>';
    frame.style.cssText = 'width: 300px; height: 150px';
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.append(frame, outside);
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    let frameClicks = 0;
    frame.contentDocument!.addEventListener('click', () => frameClicks++);
    // The test document must hold focus first, as a page the user is working in does.
    await userEvent.click(outside);
    startCapture();

    // A real click at the frame's centre lands in the frame's own document.
    await userEvent.click(frame);
    expect(frameClicks).toBe(1);

    await expect.poll(() => controller!.live.textContent).toBe("Content inside frames can't be annotated.");
    expect(controller!.active).toBe(true);
    expect(selected).toEqual([]);
    frame.remove();
    outside.remove();
  });
});

describe('repeat clicks inside frames (real browser)', () => {
  it('announces the frame status again after the pointer has hovered top-level content', async () => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button style="width: 300px; height: 150px">inner</button>';
    frame.style.cssText = 'width: 300px; height: 150px';
    const outside = document.createElement('button');
    outside.id = 'outside';
    outside.textContent = 'outside';
    document.body.append(frame, outside);
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    let frameClicks = 0;
    frame.contentDocument!.addEventListener('click', () => frameClicks++);
    await userEvent.click(outside);
    startCapture();

    await userEvent.click(frame);
    await expect.poll(() => controller!.live.textContent).toBe("Content inside frames can't be annotated.");

    await userEvent.hover(outside);
    await expect.poll(() => controller!.live.textContent).toBe('button#outside');

    await userEvent.click(frame);
    expect(frameClicks).toBe(2);
    await expect.poll(() => controller!.live.textContent).toBe("Content inside frames can't be annotated.");
    expect(controller!.active).toBe(true);
    expect(selected).toEqual([]);
    frame.remove();
    outside.remove();
  });
});

describe('a page that stops events at window capture (real browser)', () => {
  const HOSTILE = ['click', 'pointerdown', 'pointermove'] as const;
  let pageSaw: string[];
  const hostile = (event: Event) => {
    pageSaw.push(event.type);
    event.stopPropagation();
  };

  beforeEach(() => {
    // The content script installs its listeners at document_start, before any page script.
    interceptPageEvents(window);
    pageSaw = [];
    for (const type of HOSTILE) window.addEventListener(type, hostile, true);
  });

  afterEach(() => {
    for (const type of HOSTILE) window.removeEventListener(type, hostile, true);
  });

  it('keeps the overlay buttons working and commits a click while capture is active', async () => {
    const button = document.createElement('button');
    button.textContent = 'Overlay';
    button.style.cssText = 'position: fixed; right: 10px; bottom: 10px';
    let overlayClicks = 0;
    button.addEventListener('click', () => overlayClicks++);
    host.shadowRoot!.append(button);
    startCapture();

    await userEvent.click(button);
    expect(overlayClicks).toBe(1);
    expect(controller!.active).toBe(true);

    await userEvent.click(target);
    expect(selected.map((context) => context.id)).toEqual(['zoom-target']);
  });

  it("leaves every event to the page's own handlers while capture is idle", async () => {
    startCapture();
    controller!.deactivate();
    let targetClicks = 0;
    target.addEventListener('click', () => targetClicks++);

    await userEvent.click(target);

    expect(pageSaw).toEqual(expect.arrayContaining(['pointermove', 'pointerdown', 'click']));
    expect(selected).toEqual([]);
    expect(targetClicks).toBe(0);
  });
});
