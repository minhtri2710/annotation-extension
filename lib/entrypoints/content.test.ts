// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import contentScript from '../../entrypoints/content';
import { interceptPageEvents, releasePageEvents } from '../capture';
import { CAPTURE_TOGGLE_MESSAGE } from '../capture/activation';
import { SITE_POLICY_STORAGE_KEY, writePolicy } from '../options/storage';

// Spy: the content script's event bus is closure-private; the real bus runs, and each `on` records its unsubscriber.
const busSubscriptions = vi.hoisted(() => [] as { event: PropertyKey; unsubscribe: import('vitest').Mock }[]);
vi.mock('../ui/event-bus', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ui/event-bus')>();
  return {
    createEventBus: <Events extends object>() => {
      const bus = original.createEventBus<Events>();
      const on: typeof bus.on = (event, handler) => {
        const unsubscribe = vi.fn(bus.on(event, handler));
        busSubscriptions.push({ event, unsubscribe });
        return unsubscribe;
      };
      return { ...bus, on };
    },
  };
});

const HOST = 'annotation-extension-root';
const PAGE_EVENTS = ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown'];

let ctx: ContentScriptContext;
let readyState: DocumentReadyState;

// Stub: happy-dom's document is always 'complete'; the getter lets a test start the script at document_start.
function stubReadyState(state: DocumentReadyState) {
  readyState = state;
  vi.spyOn(document, 'readyState', 'get').mockImplementation(() => readyState);
}

// Stub: happy-dom has no popover API, which raiseOverlay uses to lift the host into the top layer.
function stubPopover() {
  const proto = HTMLElement.prototype as { showPopover?: () => void };
  const original = proto.showPopover;
  proto.showPopover = function showPopover() {};
  return () => {
    if (original) proto.showPopover = original;
    else delete proto.showPopover;
  };
}

let restorePopover: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  restorePopover = stubPopover();
  document.body.replaceChildren();
  ctx = new ContentScriptContext('content', { noScriptStartedPostMessage: true });
});

afterEach(() => {
  ctx.notifyInvalidated();
  restorePopover();
  vi.restoreAllMocks();
});

const hosts = () => [...document.querySelectorAll(HOST)];
const shadow = () => {
  const [host] = hosts();
  if (!host?.shadowRoot) throw new Error('overlay is not mounted');
  return host.shadowRoot;
};
const button = (text: string) => {
  const match = [...shadow().querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')]
    .find((candidate) => candidate.textContent === text);
  if (!match) throw new Error(`no toolbar button "${text}"`);
  return match;
};
const panel = () => shadow().querySelector<HTMLElement>('[role="region"]')!;
const toolbarButtons = () => [...shadow().querySelectorAll('[role="toolbar"] button')].map((b) => b.textContent);

const start = () => contentScript.main(ctx);

describe('content script entrypoint', () => {
  it('registers page listeners at document_start and mounts the overlay only once the DOM is ready', async () => {
    stubReadyState('loading');
    const added = vi.spyOn(window, 'addEventListener');
    const running = contentScript.main(ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hosts()).toEqual([]);
    expect(added.mock.calls.filter(([, , capture]) => capture === true).map(([type]) => type)).toEqual(PAGE_EVENTS);

    readyState = 'interactive';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await running;

    expect(hosts()).toHaveLength(1);
    expect(toolbarButtons().filter((text) => text !== '⠿').slice(0, 3)).toEqual(['Scan', 'View all', 'Annotate']);
  });

  it('does not mount the overlay when the site policy disallows the page', async () => {
    await writePolicy({ enabled: true, allowlist: ['other.example'] });
    await start();

    expect(hosts()).toEqual([]);
  });

  it('unmounts when the policy disallows the page and remounts a single overlay when it allows it again', async () => {
    await start();
    expect(hosts()).toHaveLength(1);

    await writePolicy({ enabled: false, allowlist: [] });
    await vi.waitFor(() => expect(hosts()).toEqual([]));

    await writePolicy({ enabled: true, allowlist: [] });
    await vi.waitFor(() => expect(hosts()).toHaveLength(1));
    expect(toolbarButtons().filter((text) => text === 'Scan')).toEqual(['Scan']);
    expect(hosts()[0]!.isConnected).toBe(true);
  });

  it('does not mount again when a policy write keeps the page enabled', async () => {
    const raised: Element[] = [];
    (HTMLElement.prototype as { showPopover?: () => void }).showPopover = function showPopover(this: Element) {
      raised.push(this);
    };
    await start();
    const [host] = hosts();
    expect(raised).toEqual([host]);

    await writePolicy({ enabled: true, allowlist: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(raised).toEqual([host]);
    expect(hosts()).toEqual([host]);
  });

  it('ignores policy-key changes outside local storage', async () => {
    await start();
    const get = vi.spyOn(browser.storage.local, 'get');
    const change = { [SITE_POLICY_STORAGE_KEY]: { newValue: { enabled: false, allowlist: [] } } };

    await fakeBrowser.storage.onChanged.trigger(change, 'sync');
    await fakeBrowser.storage.onChanged.trigger(change, 'session');
    expect(get.mock.calls.filter(([key]) => key === SITE_POLICY_STORAGE_KEY)).toEqual([]);

    await fakeBrowser.storage.onChanged.trigger(change, 'local');
    expect(get.mock.calls.filter(([key]) => key === SITE_POLICY_STORAGE_KEY)).toEqual([[SITE_POLICY_STORAGE_KEY]]);
  });

  it('does not re-read the policy for a local change to another key', async () => {
    await start();
    const get = vi.spyOn(browser.storage.local, 'get');

    await fakeBrowser.storage.onChanged.trigger({ 'unrelated:key': { newValue: 1 } }, 'local');

    expect(get.mock.calls.filter(([key]) => key === SITE_POLICY_STORAGE_KEY)).toEqual([]);
  });

  it('opening one panel closes the other panel mode', async () => {
    await start();
    button('View all').click();
    expect(button('View all').getAttribute('aria-expanded')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Annotations on this page');

    button('Scan').click();

    expect(button('View all').getAttribute('aria-expanded')).toBe('false');
    expect(button('Scan').getAttribute('aria-expanded')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Page scan');
  });

  it('closing a panel with Escape returns focus to the toggle that opened it', async () => {
    await start();
    const toggle = button('View all');
    toggle.click();
    await vi.waitFor(() => expect(panel().querySelector('button, [tabindex]')).not.toBeNull());
    const inside = panel().querySelector<HTMLElement>('button, [tabindex]')!;
    inside.focus();
    expect(shadow().activeElement).toBe(inside);

    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

    expect(panel().hasAttribute('aria-label')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(shadow().activeElement).toBe(toggle);
  });

  it('releases the page listeners, the route watch and the policy watcher when the context is invalidated', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const storageListeners = vi.spyOn(browser.storage.onChanged, 'addListener');
    await start();
    const routeHandlers = added.mock.calls.filter(([type]) => type === 'popstate' || type === 'hashchange');
    const pageHandlers = added.mock.calls.filter(([, , capture]) => capture === true);
    expect(routeHandlers.map(([type]) => type)).toEqual(['popstate', 'hashchange']);
    const hub = interceptPageEvents(window);

    ctx.notifyInvalidated();

    expect(hosts()).toEqual([]);
    const kept = [...routeHandlers, ...pageHandlers]
      .filter(([type, handler]) => !removed.mock.calls.some(([t, h]) => t === type && h === handler))
      .map(([type]) => type);
    expect(kept).toEqual([]);
    expect(interceptPageEvents(window)).not.toBe(hub);
    releasePageEvents(window);
    expect(storageListeners.mock.calls).toHaveLength(2);
    expect(storageListeners.mock.calls.map(([listener]) => browser.storage.onChanged.hasListener(listener))).toEqual([false, false]);
  });

  it('removes the runtime message listener and the selection subscription when the context is invalidated', async () => {
    busSubscriptions.length = 0;
    const messageListeners = vi.spyOn(browser.runtime.onMessage, 'addListener');
    await start();
    const [messageListener] = messageListeners.mock.calls.map(([listener]) => listener);
    expect(browser.runtime.onMessage.hasListener(messageListener!)).toBe(true);
    const selection = busSubscriptions.filter(({ event }) => event === 'element:selected');
    expect(selection.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[]]);

    ctx.notifyInvalidated();

    expect(browser.runtime.onMessage.hasListener(messageListener!)).toBe(false);
    expect(selection.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[[]]]);
  });

  it('toggles capture only for a capture-toggle runtime message', async () => {
    await start();
    const [host] = hosts();

    await fakeBrowser.runtime.onMessage.trigger({ type: 'capture.start' }, {}, () => {});
    expect(host!.hasAttribute('data-annotation-active')).toBe(false);
    expect(button('Annotate').getAttribute('aria-pressed')).toBe('false');

    await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
    expect(host!.hasAttribute('data-annotation-active')).toBe(true);
    expect(button('Stop annotating').getAttribute('aria-pressed')).toBe('true');
  });

  it('releases the capture-state subscription when the context is invalidated', async () => {
    busSubscriptions.length = 0;
    await start();
    const captureState = busSubscriptions.filter(({ event }) => event === 'capture:active');
    expect(captureState.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[]]);

    ctx.notifyInvalidated();

    expect(captureState.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[[]]]);
  });
});
