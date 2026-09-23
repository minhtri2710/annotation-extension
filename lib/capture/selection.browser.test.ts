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
});
