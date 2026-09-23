import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElementContext } from './context';
import { createCaptureController, type CaptureController, type CaptureEvents } from './selection';
import { createEventBus } from '../ui/event-bus';

let host: HTMLElement;
let controller: CaptureController;
let selected: ElementContext[];

function key(name: string) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

function label() {
  return host.shadowRoot!.querySelector('[data-annotation-highlight-label]')!.textContent;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.replaceChildren();
  host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  selected = [];
  const bus = createEventBus<CaptureEvents>();
  bus.on('element:selected', (context) => selected.push(context));
  controller = createCaptureController({ document, shadowHost: host, bus });
});

afterEach(() => {
  controller.destroy();
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('keyboard capture (real browser)', () => {
  it('starts at the element under the viewport centre, beneath the extension overlay', () => {
    const cover = document.createElement('div');
    cover.id = 'cover';
    cover.style.cssText = 'width: 100vw; height: 100vh';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; inset: 0';
    host.shadowRoot!.append(overlay);
    document.body.append(cover, host);
    controller.activate();

    expect(key('ArrowUp').defaultPrevented).toBe(true);
    expect(label()).toBe('div#cover');
  });

  it('resolves the viewport centre into an open shadow root', () => {
    const card = document.createElement('x-card');
    card.attachShadow({ mode: 'open' }).setHTMLUnsafe(
      '<span id="inside" style="display: block; width: 100vw; height: 100vh">x</span>',
    );
    document.body.append(card, host);
    controller.activate();

    key('Enter');
    expect(label()).toBe('span#inside');
    expect(selected).toEqual([]);
    key('Enter');
    expect(selected.map((context) => context.id)).toEqual(['inside']);
  });

  it('scrolls the element each keyboard move highlights into view', () => {
    const first = document.createElement('div');
    first.id = 'first';
    first.style.cssText = 'height: 100vh';
    const far = document.createElement('div');
    far.id = 'far';
    far.style.cssText = 'height: 50px; margin-top: 3000px';
    document.body.append(first, far, host);
    controller.activate();

    key('ArrowDown');
    expect(label()).toBe('div#first');
    expect(far.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight);

    key('ArrowRight');
    expect(label()).toBe('div#far');
    const rect = far.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it('walks past display:none and script siblings in a real layout', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p id="a" style="height: 100vh">a</p><script></script><div id="gone" style="display: none">g</div><p id="b">b</p>',
    );
    document.body.append(host);
    controller.activate();

    key('ArrowDown');
    expect(label()).toBe('p#a');
    key('ArrowRight');
    expect(label()).toBe('p#b');
  });

  it('keeps the highlight on the element while a nested scroller scrolls', async () => {
    const scroller = document.createElement('div');
    scroller.style.cssText = 'height: 200px; overflow: auto';
    const item = document.createElement('div');
    item.id = 'item';
    item.style.cssText = 'height: 50px; margin-top: 100px';
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height: 2000px';
    scroller.append(item, spacer);
    document.body.append(scroller, host);
    controller.activate();
    item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    const box = host.shadowRoot!.querySelector<HTMLElement>('[data-annotation-highlight]')!;
    expect(box.style.top).toBe(`${item.getBoundingClientRect().top}px`);

    scroller.scrollTop = 80;
    await new Promise<void>((resolve) => scroller.addEventListener('scroll', () => resolve(), { once: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(item.getBoundingClientRect().top).toBe(20);
    expect(box.style.top).toBe('20px');
  });
});

describe('capture across realms (real browser)', () => {
  it('walks up from a shadow child to its host when the root comes from an iframe realm', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const card = frameDocument.createElement('x-card');
    card.id = 'card';
    card.attachShadow({ mode: 'open' }).setHTMLUnsafe('<span id="inner" style="display: block; height: 100vh">i</span>');
    const frameHost = frameDocument.createElement('div');
    frameHost.attachShadow({ mode: 'open' });
    frameDocument.body.append(card, frameHost);
    const frameSelected: ElementContext[] = [];
    const bus = createEventBus<CaptureEvents>();
    bus.on('element:selected', (context) => frameSelected.push(context));
    const frameController = createCaptureController({ document: frameDocument, shadowHost: frameHost, bus });
    const frameKey = (name: string) =>
      frameDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

    frameController.activate();
    frameKey('ArrowDown');
    frameKey('Enter');
    frameController.activate();
    frameKey('ArrowDown');
    frameKey('ArrowUp');
    frameKey('Enter');
    frameController.destroy();
    frame.remove();

    expect(frameSelected.map((context) => context.id)).toEqual(['inner', 'card']);
  });

  it('commits the composedPath target of a pointer event from an iframe realm', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    frameDocument.body.style.margin = '0';
    const spacer = frameDocument.createElement('div');
    spacer.id = 'spacer';
    spacer.style.cssText = 'height: 50px';
    const target = frameDocument.createElement('button');
    target.id = 'target';
    const frameHost = frameDocument.createElement('div');
    frameHost.attachShadow({ mode: 'open' });
    frameDocument.body.append(spacer, target, frameHost);
    const frameSelected: ElementContext[] = [];
    const bus = createEventBus<CaptureEvents>();
    bus.on('element:selected', (context) => frameSelected.push(context));
    const frameController = createCaptureController({ document: frameDocument, shadowHost: frameHost, bus });
    const FramePointerEvent = (frame.contentWindow as Window & typeof globalThis).PointerEvent;

    frameController.activate();
    target.dispatchEvent(
      new FramePointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }),
    );
    frameController.destroy();
    frame.remove();

    expect(frameSelected.map((context) => context.id)).toEqual(['target']);
  });
});
