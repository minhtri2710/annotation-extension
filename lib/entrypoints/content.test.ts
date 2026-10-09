// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import background from '../../entrypoints/background';
import contentScript from '../../entrypoints/content';
import { addAnnotation, listAnnotations } from '../annotation-storage';
import { registerBackgroundMessageHandlers } from '../wiring/background-messages';
import { interceptPageEvents, releasePageEvents } from '../capture';
import { CAPTURE_STATE_MESSAGE, CAPTURE_TOGGLE_MESSAGE } from '../capture/activation';
import { SITE_POLICY_STORAGE_KEY, writePolicy } from '../options/storage';
import { ANNOTATION_SCAN_CLOSE_EVENT } from '../scan-panel/scan-panel';
import type { ToolbarPrefs } from '../ui/ui-prefs';
import { readToolbarTab } from '../wiring/toolbar-tab-messages';

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

const scanCalls = vi.hoisted(() => ({ scan: 0, deep: 0 }));
vi.mock('../scan-panel/scan-panel', async (importOriginal) => {
  const original = await importOriginal<typeof import('../scan-panel/scan-panel')>();
  return {
    ...original,
    scanPage: (...args: Parameters<typeof original.scanPage>) => {
      scanCalls.scan += 1;
      return original.scanPage(...args);
    },
    deepScanPage: (...args: Parameters<typeof original.deepScanPage>) => {
      scanCalls.deep += 1;
      return original.deepScanPage(...args);
    },
  };
});

const HOST = 'annotation-extension-root';
const PAGE_EVENTS = ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown'];

let ctx: ContentScriptContext;
let readyState: DocumentReadyState;
const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;

function stubReadyState(state: DocumentReadyState) {
  readyState = state;
  vi.spyOn(document, 'readyState', 'get').mockImplementation(() => readyState);
}

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
  scanCalls.scan = 0;
  scanCalls.deep = 0;
  fakeBrowser.reset();
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = originalAttachShadow.call(this, init);
    attachedRoots.set(this, root);
    return root;
  });
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
  const root = host && attachedRoots.get(host);
  if (!root) throw new Error('overlay is not mounted');
  return root;
};
const dispatchTrusted = <T extends Event>(target: EventTarget, event: T): T => {
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
};
const trustedClick = (target: EventTarget) => dispatchTrusted(
  target,
  new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
);
const nameOf = (control: Element) => control.getAttribute('aria-label') ?? control.textContent;
const button = (name: string) => {
  const match = [...shadow().querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')]
    .find((candidate) => nameOf(candidate) === name);
  if (!match) throw new Error(`no toolbar button "${name}"`);
  return match;
};
const panel = () => shadow().querySelector<HTMLElement>('[role="region"]')!;
const toolbarButtons = () => [...shadow().querySelectorAll('[role="toolbar"] button')].map(nameOf);

const start = () => contentScript.main(ctx);
const pushToolbar = (on: unknown) => fakeBrowser.runtime.onMessage.trigger({ type: 'toolbar.changed', on }, {}, () => {});

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
    expect(toolbarButtons().filter((text) => text !== 'Move toolbar').slice(0, 3)).toEqual(['Scan', 'View all', 'Annotate']);
  });

  it('draws Scan, View all, the Hide toolbar control and the grip as icons with a name and a title, and keeps Annotate as text', async () => {
    await start();
    const iconOnly = ['Scan', 'View all', 'Hide toolbar on this tab', 'Move toolbar'].map(button);
    for (const control of iconOnly) {
      expect(control.textContent).toBe(control.querySelector('[data-annotation-badge]')?.textContent ?? '');
      expect(control.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(control.title).toBe(control.getAttribute('aria-label'));
    }
    expect(button('Annotate').textContent).toBe('Annotate');
    expect(button('Annotate').querySelector('svg')).toBeNull();
  });

  it('puts the annotation count badge on the View all button and describes the button by it', async () => {
    await start();
    const viewAll = button('View all');
    const badge = viewAll.querySelector<HTMLElement>('[data-annotation-badge]')!;
    expect(badge).not.toBeNull();
    expect(viewAll.getAttribute('aria-describedby')).toBe(badge.id);
    expect(badge.hidden).toBe(true);
    expect(viewAll.parentElement!.querySelectorAll(':scope > [data-annotation-badge]')).toHaveLength(0);
  });

  it('uses a closed shadow root that page script cannot reach', async () => {
    await start();

    expect(hosts()[0]!.shadowRoot).toBeNull();
  });

  it('drops untrusted list-clear input but permits the same trusted control sequence', async () => {
    const storedContext = {
      selector: '#missing', tagName: 'div', id: 'missing', classList: [], text: '',
      boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: location.href,
      viewport: { width: 800, height: 600 }, sourcePath: null,
    };
    await addAnnotation(location.href, {
      note: 'Stored note',
      selector: '#missing',
      elementContext: storedContext,
    });
    await addAnnotation(location.href, { note: 'Second stored note', selector: '#missing', elementContext: storedContext });
    registerBackgroundMessageHandlers({ blobStore: { get: async () => undefined, put: async () => undefined, delete: async () => undefined } });
    await start();
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage');
    const set = vi.spyOn(browser.storage.local, 'set');
    const remove = vi.spyOn(browser.storage.local, 'remove');
    const storedBefore = await browser.storage.local.get(null);
    const viewAll = button('View all');
    viewAll.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    expect(panel().querySelector('[data-annotation-clear]')).toBeNull();
    trustedClick(viewAll);
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-clear]')).not.toBeNull());
    const clear = panel().querySelector<HTMLButtonElement>('[data-annotation-clear]')!;
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    expect(panel().querySelector('[data-annotation-clear-confirm]')).toBeNull();
    trustedClick(clear);
    const confirm = panel().querySelector<HTMLButtonElement>('[data-annotation-clear-confirm]')!;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    const row = panel().querySelector('[data-annotation-row]')!;
    const removeRow = row.querySelector<HTMLButtonElement>('[data-annotation-delete]')!;
    removeRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    expect(panel().querySelector('[data-annotation-delete-confirm]')).toBeNull();
    trustedClick(removeRow);
    const deleteConfirm = panel().querySelector<HTMLButtonElement>('[data-annotation-delete-confirm]')!;
    deleteConfirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));

    expect(await browser.storage.local.get(null)).toEqual(storedBefore);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.filter(([message]) => ['annotation.clear', 'annotation.delete'].includes((message as { type?: string }).type ?? ''))).toEqual([]);

    trustedClick(deleteConfirm);
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => (message as { type?: string }).type === 'annotation.delete')).toHaveLength(1));
    expect(remove).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-clear]')).not.toBeNull());
    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-clear]')!);
    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-clear-confirm]')!);
    await vi.waitFor(async () => expect(await browser.storage.local.get(null)).toEqual({}));
    expect(sendMessage.mock.calls.filter(([message]) => (message as { type?: string }).type === 'annotation.clear')).toHaveLength(1);
  });

  it('ignores an untrusted Escape at the window but accepts a trusted Escape while capture is active', async () => {
    await start();
    await pushToolbar(true);
    await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
    const host = hosts()[0]!;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(host.hasAttribute('data-annotation-active')).toBe(true);

    dispatchTrusted(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(host.hasAttribute('data-annotation-active')).toBe(false);
  });

  it('marks Annotate as the only primary toolbar button', async () => {
    await start();

    const primary = [...shadow().querySelectorAll('[role="toolbar"] button[data-variant="primary"]')];
    expect(primary).toEqual([button('Annotate')]);
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

  it('stops re-reading the capture shortcut on a visible page once the site policy unmounts the open list', async () => {
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ shortcut: 'Alt+Q' } as never);
    const shortcutReads = () => send.mock.calls.filter(([message]) => (message as { type?: unknown }).type === 'capture.shortcut');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await start();
    trustedClick(button('View all'));
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-onboarding]')).not.toBeNull());

    await writePolicy({ enabled: false, allowlist: [] });
    await vi.waitFor(() => expect(hosts()).toEqual([]));
    const reads = shortcutReads().length;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(shortcutReads()).toHaveLength(reads);
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
    trustedClick(button('View all'));
    expect(button('View all').getAttribute('aria-expanded')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Annotations on this page');

    trustedClick(button('Scan'));

    expect(button('View all').getAttribute('aria-expanded')).toBe('false');
    expect(button('Scan').getAttribute('aria-expanded')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Page scan');
  });

  it('closing a panel with Escape returns focus to the toggle that opened it', async () => {
    await start();
    const toggle = button('View all');
    trustedClick(toggle);
    await vi.waitFor(() => expect(panel().querySelector('button, [tabindex]')).not.toBeNull());
    const inside = panel().querySelector<HTMLElement>('button, [tabindex]')!;
    inside.focus();
    expect(shadow().activeElement).toBe(inside);

    dispatchTrusted(inside, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

    expect(panel().hasAttribute('aria-label')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(shadow().activeElement).toBe(toggle);
  });

  it('the scan-close event, also from the scan panel Close, closes an open scan panel and returns focus to Scan', async () => {
    await start();
    const toggle = button('Scan');
    for (const close of [
      () => trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-scan-header] button')!),
      () => panel().dispatchEvent(new Event(ANNOTATION_SCAN_CLOSE_EVENT)),
    ]) {
      trustedClick(toggle);
      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-scan-header]')).not.toBeNull());
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      panel().querySelector<HTMLButtonElement>('[data-annotation-scan-header] button')!.focus();
      close();
      expect(panel().hasAttribute('aria-label')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(shadow().activeElement).toBe(toggle);
    }
  });

  it('Annotate on a scan finding opens the note panel for its element seeded with the finding, and closing it returns to the scan', async () => {
    const image = document.createElement('img');
    image.id = 'broken';
    document.body.append(image);
    await start();
    const scan = button('Scan');
    trustedClick(scan);
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-scan-annotate]')).not.toBeNull());
    const annotate = panel().querySelector<HTMLButtonElement>('[data-annotation-scan-annotate]')!;
    expect(annotate.getAttribute('aria-label')).toBe('Annotate finding 1: Broken or placeholder image');
    annotate.focus();

    trustedClick(annotate);

    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-new-note]')).not.toBeNull());
    expect(panel().getAttribute('aria-label')).toBe('Annotation note');
    expect(scan.getAttribute('aria-expanded')).toBe('false');
    expect(panel().querySelector<HTMLElement>('[data-annotation-hint]')?.title).toBe('#broken');
    const note = panel().querySelector<HTMLTextAreaElement>('[data-annotation-new-note]')!;
    expect(note.value).toBe('Broken or placeholder image: <img> with no src attribute');
    expect(shadow().activeElement).toBe(note);

    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!);

    expect(panel().getAttribute('aria-label')).toBe('Page scan');
    expect(shadow().activeElement).toBe(annotate);
  });

  describe('Annotate from a scan finding', () => {
    const firstUrl = location.href;
    const SEED = 'Broken or placeholder image: <img> with no src attribute';
    const addImages = (count: number) => Array.from({ length: count }, (_, index) => {
      const image = document.createElement('img');
      image.id = `broken-${index}`;
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20 + 40 * index, width: 30, height: 30 }));
      document.body.append(image);
      return image;
    });
    const outlines = (root: ParentNode = shadow()) => [...root.querySelectorAll<HTMLElement>('[data-annotation-scan-outline]')];
    const annotateButtons = () => [...panel().querySelectorAll<HTMLButtonElement>('[data-annotation-scan-annotate]')];
    const noteField = () => panel().querySelector<HTMLTextAreaElement>('[data-annotation-new-note]');
    const openScan = async () => {
      trustedClick(button('Scan'));
      await vi.waitFor(() => expect(annotateButtons().length).toBeGreaterThan(0));
    };
    const annotate = async (index: number) => {
      const row = annotateButtons()[index]!;
      row.focus();
      trustedClick(row);
      await vi.waitFor(() => expect(noteField()).not.toBeNull());
      return row;
    };
    const escapeFrom = (target: Element) =>
      dispatchTrusted(target, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    const pointerEvent = (type: string, target: EventTarget) =>
      dispatchTrusted(target, new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }));
    const outsideClick = () => {
      const page = document.body.appendChild(document.createElement('p'));
      pointerEvent('pointerdown', page);
      pointerEvent('pointerup', page);
      dispatchTrusted(page, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1 }));
    };
    const expectScanBack = (before: HTMLElement[], emphasised?: number) => {
      expect(panel().getAttribute('aria-label')).toBe('Page scan');
      expect(button('Scan').getAttribute('aria-expanded')).toBe('true');
      expect(annotateButtons()).toHaveLength(before.length);
      expect(outlines()).toEqual(before);
      for (const outline of before) expect(outline.hidden).toBe(false);
      expect(before.filter((outline) => outline.hasAttribute('data-annotation-emphasis'))).toEqual(emphasised === undefined ? [] : [before[emphasised]]);
    };
    const storedContext = (selector: string) => ({
      selector, tagName: 'div', id: selector.slice(1), classList: [], text: '',
      boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: location.href,
      viewport: { width: 800, height: 600 }, sourcePath: null,
    });
    const handlers = () => registerBackgroundMessageHandlers({ blobStore: { get: async () => undefined, put: async () => undefined, delete: async () => undefined } });

    afterEach(() => history.replaceState(null, '', firstUrl));

    it('keeps only the annotated finding\'s box, with its number and severity, on its element and emphasised while the note is open', async () => {
      addImages(2);
      await start();
      await openScan();
      const before = outlines();
      expect(before).toHaveLength(2);
      const second = before[1]!;
      const severity = second.dataset.annotationScanOutline;

      await annotate(1);

      expect(outlines()).toEqual([second]);
      expect(second.hidden).toBe(false);
      expect(second.dataset.annotationScanOutline).toBe(severity);
      expect(second.querySelector('[data-annotation-scan-outline-number]')?.textContent).toBe('2');
      expect(second.hasAttribute('data-annotation-emphasis')).toBe(true);
      expect(second.style.top).toBe('60px');
      expect(panel().getAttribute('aria-label')).toBe('Annotation note');
      expect(button('Scan').getAttribute('aria-expanded')).toBe('false');
      expect(noteField()?.value).toBe(SEED);
    });

    it.each([
      ['its Close button', () => trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!)],
      ['Escape inside the note panel', () => escapeFrom(noteField()!)],
    ])('%s brings back the scan the user left and focuses the finding\'s Annotate button', async (_name, close) => {
      addImages(2);
      await start();
      await openScan();
      const before = outlines();
      const row = await annotate(1);

      close();

      expectScanBack(before, 1);
      expect(shadow().activeElement).toBe(row);
    });

    it('an outside click closes the note without bringing the scan back', async () => {
      addImages(2);
      await start();
      await openScan();
      await annotate(0);

      outsideClick();

      expect(panel().hasAttribute('aria-label')).toBe(false);
      expect(button('Scan').getAttribute('aria-expanded')).toBe('false');
      expect(outlines()).toEqual([]);
    });

    it('carries no emphasis over from before Annotate: a Locate on another finding is gone after an outside click and a reopened scan', async () => {
      addImages(2);
      await start();
      await openScan();
      const before = outlines();
      const rowTwo = panel().querySelector<HTMLElement>('[data-annotation-scan-number="2"]')!;
      trustedClick(rowTwo.querySelector<HTMLButtonElement>('[data-annotation-scan-locate]')!);
      expect(before[1]!.hasAttribute('data-annotation-emphasis')).toBe(true);
      trustedClick(annotateButtons()[0]!);
      await vi.waitFor(() => expect(noteField()).not.toBeNull());

      outsideClick();
      await openScan();
      const reopenedRowTwo = panel().querySelector<HTMLElement>('[data-annotation-scan-number="2"]')!;
      reopenedRowTwo.dispatchEvent(new MouseEvent('mouseenter'));
      reopenedRowTwo.dispatchEvent(new MouseEvent('mouseleave'));

      expect(outlines().filter((outline) => outline.hasAttribute('data-annotation-emphasis'))).toEqual([]);
    });

    it('a saved note brings back the scan, focuses the finding\'s Annotate button and announces Note saved. in the note panel\'s live region', async () => {
      handlers();
      addImages(2);
      await start();
      await openScan();
      const before = outlines();
      const row = await annotate(1);

      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-save]')!);

      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Page scan'));
      expectScanBack(before, 1);
      expect(shadow().activeElement).toBe(row);
      expect([...shadow().querySelectorAll('[data-annotation-live]')].some((live) => live.textContent === 'Note saved.')).toBe(true);
      expect((await listAnnotations(location.href)).map((stored) => [stored.selector, stored.note])).toEqual([['#broken-1', SEED]]);
    });

    it('keeps the note panel open with its message for an empty note and for a failed write', async () => {
      handlers();
      addImages(2);
      await start();
      await openScan();
      await annotate(0);
      const note = noteField()!;
      note.value = '';
      note.dispatchEvent(new Event('input', { bubbles: true }));

      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-save]')!);

      expect(panel().querySelector('[data-annotation-status]')?.textContent).toBe('Write a note before saving.');
      expect(panel().getAttribute('aria-label')).toBe('Annotation note');

      note.value = 'A note';
      note.dispatchEvent(new Event('input', { bubbles: true }));
      vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(new Error('Write failed'));
      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-save]')!);

      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-status]')?.textContent).toContain('Write failed'));
      expect(panel().getAttribute('aria-label')).toBe('Annotation note');
      expect(await listAnnotations(location.href)).toEqual([]);
    });

    it('returns to the scan when an existing annotation\'s edit is saved', async () => {
      handlers();
      addImages(2);
      await addAnnotation(location.href, { note: 'Stored note', selector: '#broken-0', elementContext: storedContext('#broken-0') });
      await start();
      await openScan();
      const before = outlines();
      await annotate(0);
      const edit = panel().querySelector<HTMLTextAreaElement>('[data-annotation-edit-note]')!;
      edit.value = 'Changed note';
      edit.dispatchEvent(new Event('input', { bubbles: true }));

      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-edit]')!);

      await vi.waitFor(async () => expect((await listAnnotations(location.href))[0]?.note).toBe('Changed note'));
      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Page scan'));

      expectScanBack(before, 0);
    });

    it('returns to the same scan: no second scan, the same summary, filter, closed group and revealed rows, and a second Annotate keeps its box', async () => {
      addImages(12);
      await start();
      await openScan();
      const summary = panel().querySelector('[data-annotation-scan-summary]')!;
      const summaryText = summary.textContent;
      const chips = [...panel().querySelectorAll<HTMLButtonElement>('[data-annotation-filter-value]')];
      trustedClick(chips[1]!);
      const group = panel().querySelector<HTMLDetailsElement>('[data-annotation-scan-group]')!;
      group.open = false;
      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-scan-more]')!);
      expect(annotateButtons()).toHaveLength(12);
      const before = outlines();
      const numbers = before.map((outline) => outline.textContent);
      await annotate(11);
      expect(outlines()).toEqual([before[11]]);

      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!);

      expectScanBack(before, 11);
      expect(scanCalls).toEqual({ scan: 1, deep: 0 });
      expect(panel().querySelector('[data-annotation-scan-summary]')).toBe(summary);
      expect(summary.textContent).toBe(summaryText);
      expect(chips[1]!.getAttribute('aria-pressed')).toBe('true');
      expect(chips[0]!.getAttribute('aria-pressed')).toBe('false');
      expect(group.open).toBe(false);
      expect(panel().querySelector('[data-annotation-scan-more]')).toBeNull();
      expect(outlines().map((outline) => outline.textContent)).toEqual(numbers);

      await annotate(0);
      expect(outlines()).toEqual([before[0]]);
      escapeFrom(noteField()!);
      expectScanBack(before, 0);
    });

    it('returns to a deep scan with its Deep scan: summary and without scanning again', async () => {
      addImages(2);
      await start();
      await openScan();
      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-deep-scan]')!);
      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-scan-summary]')?.textContent).toMatch(/^Deep scan: /), { timeout: 5000 });
      const before = outlines();
      const summaryText = panel().querySelector('[data-annotation-scan-summary]')!.textContent;
      await annotate(0);

      trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!);

      expectScanBack(before, 0);
      expect(panel().querySelector('[data-annotation-scan-summary]')?.textContent).toBe(summaryText);
      expect(scanCalls).toEqual({ scan: 1, deep: 1 });
    });

    describe('does not return when the note panel is replaced or closed for another reason', () => {
      const storedPin = async () => {
        await addAnnotation(location.href, { note: 'Pinned note', selector: '#target', elementContext: storedContext('#target') });
      };
      const reasons: [name: string, stored: boolean, trigger: () => Promise<void>][] = [
        ['View all', false, async () => void trustedClick(button('View all'))],
        ['Start annotating', false, async () => {
          trustedClick(button('View all'));
          await vi.waitFor(() => expect(panel().querySelector('[data-annotation-start]')).not.toBeNull());
          trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-start]')!);
        }],
        ['capture selecting an element', false, async () => {
          await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
          pointerEvent('pointerdown', document.getElementById('target')!);
          await vi.waitFor(() => expect(panel().querySelector('[data-annotation-hint]')?.getAttribute('title')).toBe('#target'));
        }],
        ['a pin', true, async () => {
          await vi.waitFor(() => expect(shadow().querySelector('.annotation-pin')).not.toBeNull());
          trustedClick(shadow().querySelector('.annotation-pin')!);
          await vi.waitFor(() => expect(panel().querySelector('[data-annotation-hint]')?.getAttribute('title')).toBe('#target'));
        }],
        ['Edit on a list row', true, async () => {
          trustedClick(button('View all'));
          await vi.waitFor(() => expect(panel().querySelector('[data-annotation-row-edit]')).not.toBeNull());
          trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-row-edit]')!);
          await vi.waitFor(() => expect(panel().querySelector('[data-annotation-hint]')?.getAttribute('title')).toBe('#target'));
        }],
        ['a route change', false, async () => {
          history.pushState(null, '', new URL('/scan-annotate-next', firstUrl).href);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }],
        ['the toolbar turning off', false, async () => {
          await pushToolbar(false);
          expect(panel().getAttribute('aria-label')).toBe('Annotation note');
        }],
      ];

      it.each(reasons)('%s drops the kept box and the remembered scan', async (_name, stored, trigger) => {
        addImages(2);
        document.body.append(Object.assign(document.createElement('div'), { id: 'target' }));
        if (stored) await storedPin();
        await start();
        await pushToolbar(true);
        await openScan();
        await annotate(0);
        expect(outlines()).toHaveLength(1);

        await trigger();

        expect(outlines()).toEqual([]);
        if (panel().hasAttribute('aria-label')) {
          await vi.waitFor(() => expect(panel().querySelector('button, textarea')).not.toBeNull());
          escapeFrom(panel().querySelector('button, textarea')!);
        }
        expect(panel().hasAttribute('aria-label')).toBe(false);
        expect(annotateButtons()).toEqual([]);
        expect(outlines()).toEqual([]);
      });

      it('Scan runs a fresh scan', async () => {
        addImages(2);
        await start();
        await openScan();
        const before = outlines();
        await annotate(0);
        expect(outlines()).toHaveLength(1);

        trustedClick(button('Scan'));

        await vi.waitFor(() => expect(annotateButtons()).toHaveLength(2));
        expect(scanCalls.scan).toBe(2);
        expect(outlines()).toHaveLength(2);
        for (const outline of outlines()) expect(before).not.toContain(outline);
      });

      it('tearing the overlay down drops the kept box', async () => {
        addImages(2);
        await start();
        const added = vi.spyOn(document, 'addEventListener');
        const removed = vi.spyOn(document, 'removeEventListener');
        await openScan();
        await annotate(0);
        const root = shadow();
        expect(outlines(root)).toHaveLength(1);

        ctx.notifyInvalidated();

        expect(outlines(root)).toEqual([]);
        const scrollListeners = added.mock.calls.filter(([type]) => type === 'scroll').map(([, listener]) => listener);
        expect(scrollListeners.length).toBeGreaterThan(0);
        for (const listener of scrollListeners) expect(removed.mock.calls.map(([, removedListener]) => removedListener)).toContain(listener);
      });
    });
  });

  it('Edit on a list row opens the note panel, and closing it focuses View all', async () => {
    await addAnnotation(location.href, {
      note: 'Stored note',
      selector: '#missing',
      elementContext: {
        selector: '#missing',
        tagName: 'div',
        id: 'missing',
        classList: [],
        text: '',
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        url: location.href,
        viewport: { width: 800, height: 600 },
        sourcePath: null,
      },
    });
    await start();
    const toggle = button('View all');
    trustedClick(toggle);
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-row-edit]')).not.toBeNull());
    const edit = panel().querySelector<HTMLButtonElement>('[data-annotation-row-edit]')!;
    edit.focus();

    trustedClick(edit);

    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-close]')).not.toBeNull());
    expect(panel().getAttribute('aria-label')).toBe('Annotation note');
    const close = panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!;
    close.focus();
    trustedClick(close);

    expect(panel().hasAttribute('aria-label')).toBe(false);
    expect(shadow().activeElement).toBe(toggle);
  });

  it('Start annotating in the empty list closes the panel and starts capture', async () => {
    await start();
    const [host] = hosts();
    const toggle = button('View all');
    trustedClick(toggle);
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-start]')).not.toBeNull());

    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-start]')!);

    expect(panel().hasAttribute('aria-label')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(host!.hasAttribute('data-annotation-active')).toBe(true);
    expect(button('Stop annotating').getAttribute('aria-pressed')).toBe('true');
  });

  it('Start annotating keeps an active capture on', async () => {
    await start();
    const [host] = hosts();
    await pushToolbar(true);
    await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
    expect(host!.hasAttribute('data-annotation-active')).toBe(true);
    trustedClick(button('View all'));
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-start]')).not.toBeNull());

    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-start]')!);

    expect(host!.hasAttribute('data-annotation-active')).toBe(true);
    expect(button('Stop annotating').getAttribute('aria-pressed')).toBe('true');
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

  it('removes every runtime message listener and ignores a toolbar change after the context is invalidated', async () => {
    const messageListeners = vi.spyOn(browser.runtime.onMessage, 'addListener');
    await start();
    await pushToolbar(true);
    const added = messageListeners.mock.calls.map(([listener]) => listener);
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added.map((listener) => browser.runtime.onMessage.hasListener(listener))).toEqual(added.map(() => true));
    const bar = shadow().querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(bar.hasAttribute('hidden')).toBe(false);

    ctx.notifyInvalidated();

    expect(added.map((listener) => browser.runtime.onMessage.hasListener(listener))).toEqual(added.map(() => false));
    await pushToolbar(false);
    expect(bar.hasAttribute('hidden')).toBe(false);
  });

  it('toggles capture only for a capture-toggle runtime message', async () => {
    await start();
    await pushToolbar(true);
    const [host] = hosts();

    await fakeBrowser.runtime.onMessage.trigger({ type: 'capture.start' }, {}, () => {});
    expect(host!.hasAttribute('data-annotation-active')).toBe(false);
    expect(button('Annotate').getAttribute('aria-pressed')).toBe('false');

    await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
    expect(host!.hasAttribute('data-annotation-active')).toBe(true);
    expect(button('Stop annotating').getAttribute('aria-pressed')).toBe('true');
  });

  it('answers a capture-state message through sendResponse and never for a toggle message', async () => {
    const messageListeners = vi.spyOn(browser.runtime.onMessage, 'addListener');
    await start();
    await pushToolbar(true);
    const [listener] = messageListeners.mock.calls.map(([added]) => added);
    const sendResponse = vi.fn();

    expect(listener!({ type: CAPTURE_STATE_MESSAGE }, {}, sendResponse)).toBeUndefined();
    expect(sendResponse.mock.calls).toEqual([[{ active: false }]]);
    const toggleResponse = vi.fn();
    expect(listener!({ type: CAPTURE_TOGGLE_MESSAGE }, {}, toggleResponse)).toBeUndefined();
    expect(toggleResponse).not.toHaveBeenCalled();
    expect(listener!({ type: CAPTURE_STATE_MESSAGE }, {}, sendResponse)).toBeUndefined();
    expect(sendResponse.mock.calls).toEqual([[{ active: false }], [{ active: true }]]);
  });

  it('releases the capture-state subscription when the context is invalidated', async () => {
    busSubscriptions.length = 0;
    await start();
    const captureState = busSubscriptions.filter(({ event }) => event === 'capture:active');
    expect(captureState.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[]]);

    ctx.notifyInvalidated();

    expect(captureState.map(({ unsubscribe }) => unsubscribe.mock.calls)).toEqual([[[]]]);
  });

  it('View all after a route change lists the annotations of the new URL', async () => {
    const firstUrl = location.href;
    const nextUrl = new URL('/fx4-next-route', firstUrl).href;
    await addAnnotation(nextUrl, {
      note: 'Next route note',
      selector: '#missing',
      elementContext: {
        selector: '#missing',
        tagName: 'div',
        id: 'missing',
        classList: [],
        text: '',
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        url: nextUrl,
        viewport: { width: 800, height: 600 },
        sourcePath: null,
      },
    });
    await start();

    history.pushState(null, '', nextUrl);
    try {
      window.dispatchEvent(new PopStateEvent('popstate'));
      trustedClick(button('View all'));

      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-row-edit]')).not.toBeNull());
      expect(panel().textContent).toContain('Next route note');
    } finally {
      history.pushState(null, '', firstUrl);
    }
  });

  it('Escape inside the scan panel during a deep scan cancels the scan and keeps the panel open', async () => {
    await start();
    trustedClick(button('Scan'));
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-deep-scan]')).not.toBeNull());
    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-deep-scan]')!);
    const cancel = panel().querySelector<HTMLButtonElement>('[data-annotation-deep-scan-cancel]');
    expect(cancel).not.toBeNull();

    dispatchTrusted(cancel!, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

    expect(panel().getAttribute('aria-label')).toBe('Page scan');
    expect(button('Scan').getAttribute('aria-expanded')).toBe('true');
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-status]')?.textContent).toBe('Deep scan cancelled'));
    expect(panel().querySelector('[data-annotation-deep-scan]')).not.toBeNull();
    expect(panel().querySelector('[data-annotation-deep-scan-cancel]')).toBeNull();
  });

  it('moving the toolbar keeps an open note panel anchored to its element', async () => {
    await addAnnotation(location.href, {
      note: 'Anchored note',
      selector: '#missing',
      elementContext: {
        selector: '#missing',
        tagName: 'div',
        id: 'missing',
        classList: [],
        text: '',
        boundingBox: { x: 300, y: 200, width: 10, height: 10 },
        url: location.href,
        viewport: { width: 800, height: 600 },
        sourcePath: null,
      },
    });
    await start();
    trustedClick(button('View all'));
    await vi.waitFor(() => expect(panel().querySelector('[data-annotation-row-edit]')).not.toBeNull());
    trustedClick(panel().querySelector<HTMLButtonElement>('[data-annotation-row-edit]')!);
    await vi.waitFor(() => expect(panel().style.top).not.toBe(''));
    expect(panel().getAttribute('aria-label')).toBe('Annotation note');
    const anchored = { top: panel().style.top, left: panel().style.left };
    expect(anchored).toEqual({ top: '192px', left: '10px' });

    dispatchTrusted(button('Move toolbar'), new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect({ top: panel().style.top, left: panel().style.left }).toEqual(anchored);
  });

  describe('per-tab toolbar', () => {
    const TAB = 9;
    const TAB_KEY = `ui:toolbar-tab:${TAB}`;
    const toolbar = () => shadow().querySelector<HTMLElement>('[role="toolbar"]')!;
    const isHidden = () => toolbar().hasAttribute('hidden');
    const isAnnotating = () => hosts()[0]!.hasAttribute('data-annotation-active');
    const storedToolbar = async () => (await browser.storage.local.get('ui:toolbar'))['ui:toolbar'] as ToolbarPrefs;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const toggleCapture = () => fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
    const requests = (send: { mock: { calls: unknown[][] } }, type: string) =>
      send.mock.calls.map(([message]) => message).filter((message) => (message as { type?: string }).type === type);

    function routeToBackground() {
      background.main();
      vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(((_tabId: number, message: unknown) =>
        fakeBrowser.runtime.onMessage.trigger(message, {}, () => {})) as never);
      return vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(((message: unknown) =>
        new Promise((resolve) => { void fakeBrowser.runtime.onMessage.trigger(message, { tab: { id: TAB } } as never, resolve); })) as never);
    }

    const stubRead = (answer: () => Promise<unknown>) =>
      vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((() => answer()) as never);

    const addPinnedAnnotation = async () => {
      const target = document.body.appendChild(document.createElement('div'));
      target.id = 'target';
      await addAnnotation(location.href, {
        note: 'Pinned note',
        selector: '#target',
        elementContext: {
          selector: '#target', tagName: 'div', id: 'target', classList: [], text: '',
          boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: location.href,
          viewport: { width: 800, height: 600 }, sourcePath: null,
        },
      });
      return target;
    };
    const pin = () => shadow().querySelector<HTMLElement>('.annotation-pin')!;

    it('mounts with the toolbar hidden and the pins shown when the tab has no stored state', async () => {
      const send = routeToBackground();
      await addPinnedAnnotation();
      await start();

      await vi.waitFor(() => expect(shadow().querySelector('.annotation-pin')).not.toBeNull());
      await settle();
      expect(isHidden()).toBe(true);
      expect(requests(send, 'toolbar.get')).toEqual([{ type: 'toolbar.get' }]);
    });

    it.each([
      ['a rejected read', () => Promise.reject(new Error('Receiving end does not exist.'))],
      ['no answer', () => Promise.resolve(undefined)],
      ['a malformed answer', () => Promise.resolve({ on: 'yes' })],
    ])('leaves the toolbar hidden after %s', async (_name, answer) => {
      const read = stubRead(answer);
      await start();
      await settle();

      expect(requests(read, 'toolbar.get')).toEqual([{ type: 'toolbar.get' }]);
      expect(isHidden()).toBe(true);
    });

    it('keeps the toolbar hidden until the background answers, then follows the answer', async () => {
      let answer: (state: unknown) => void = () => undefined;
      stubRead(() => new Promise((resolve) => { answer = resolve; }));
      await start();
      await settle();
      expect(isHidden()).toBe(true);

      answer({ on: true });

      await vi.waitFor(() => expect(isHidden()).toBe(false));
    });

    it('turns the toolbar on and off from a change message without a reload and keeps the overlay mounted', async () => {
      await start();
      const [host] = hosts();

      await pushToolbar(true);
      expect(isHidden()).toBe(false);
      await pushToolbar('yes');
      await pushToolbar(undefined);
      expect(isHidden()).toBe(false);
      await pushToolbar(false);
      expect(isHidden()).toBe(true);
      expect(hosts()).toEqual([host]);
    });

    it('lets a change that arrives during the first read win over the value that read returns', async () => {
      let answer: (state: unknown) => void = () => undefined;
      const read = stubRead(() => new Promise((resolve) => { answer = resolve; }));
      await start();
      await vi.waitFor(() => expect(requests(read, 'toolbar.get')).toHaveLength(1));

      await pushToolbar(true);
      answer({ on: false });
      await settle();

      expect(isHidden()).toBe(false);
    });

    it('reads the tab state again when the page is restored from the back/forward cache, and removes that listener with the context', async () => {
      routeToBackground();
      const removed = vi.spyOn(window, 'removeEventListener');
      await start();
      await settle();
      expect(isHidden()).toBe(true);
      const pageshow = (persisted: boolean) => {
        const event = new Event('pageshow');
        Object.defineProperty(event, 'persisted', { value: persisted });
        window.dispatchEvent(event);
      };

      await fakeBrowser.storage.session.set({ [TAB_KEY]: true });
      pageshow(false);
      await settle();
      expect(isHidden()).toBe(true);
      pageshow(true);
      await vi.waitFor(() => expect(isHidden()).toBe(false));

      await fakeBrowser.storage.session.remove(TAB_KEY);
      pageshow(true);
      await vi.waitFor(() => expect(isHidden()).toBe(true));

      ctx.notifyInvalidated();
      expect(removed.mock.calls.some(([type]) => type === 'pageshow')).toBe(true);
    });

    it('turns its own tab on in the background and then starts annotating on a capture toggle while the toolbar is off', async () => {
      routeToBackground();
      await start();
      await settle();
      expect(isHidden()).toBe(true);

      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});

      await vi.waitFor(() => expect(isAnnotating()).toBe(true));
      expect(isHidden()).toBe(false);
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({ [TAB_KEY]: true });
      await expect(fakeBrowser.storage.local.get('ui:toolbar')).resolves.toEqual({});
    });

    it('does not start annotating when the background cannot turn the tab on', async () => {
      const send = stubRead(() => Promise.reject(new Error('Storage failed')));
      await start();

      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
      await settle();

      expect(requests(send, 'toolbar.set')).toEqual([{ type: 'toolbar.set', on: true }]);
      expect(isAnnotating()).toBe(false);
      expect(isHidden()).toBe(true);
    });

    it('toggles annotating on a capture toggle while the toolbar is on, without asking the background again', async () => {
      const send = routeToBackground();
      await start();
      await pushToolbar(true);
      send.mockClear();

      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
      expect(isAnnotating()).toBe(true);
      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
      expect(isAnnotating()).toBe(false);

      expect(requests(send, 'toolbar.set')).toEqual([]);
    });

    it('stops annotating when the toolbar turns off', async () => {
      await start();
      await pushToolbar(true);
      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
      expect(isAnnotating()).toBe(true);

      await pushToolbar(false);

      expect(isAnnotating()).toBe(false);
      expect(button('Annotate').getAttribute('aria-pressed')).toBe('false');
    });

    it('closes an open list or scan panel when the toolbar turns off', async () => {
      await start();
      await pushToolbar(true);
      trustedClick(button('View all'));
      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotations on this page'));

      await pushToolbar(false);
      expect(panel().hasAttribute('aria-label')).toBe(false);
      expect(button('View all').getAttribute('aria-expanded')).toBe('false');

      await pushToolbar(true);
      trustedClick(button('Scan'));
      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Page scan'));
      await pushToolbar(false);
      expect(panel().hasAttribute('aria-label')).toBe(false);
    });

    it('keeps an open note panel when the toolbar turns off', async () => {
      await start();
      await pushToolbar(true);
      const target = document.body.appendChild(document.createElement('div'));
      target.id = 'target';
      await fakeBrowser.runtime.onMessage.trigger({ type: CAPTURE_TOGGLE_MESSAGE }, {}, () => {});
      dispatchTrusted(target, new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotation note'));

      await pushToolbar(false);

      expect(panel().getAttribute('aria-label')).toBe('Annotation note');
      expect(isHidden()).toBe(true);
    });

    it('opens the note panel from a pin while the toolbar is off', async () => {
      routeToBackground();
      await addPinnedAnnotation();
      await start();
      await vi.waitFor(() => expect(shadow().querySelector('.annotation-pin')).not.toBeNull());

      trustedClick(pin());

      await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotation note'));
      expect(isHidden()).toBe(true);
    });

    it('keeps the stored position through turning the toolbar off and on', async () => {
      await start();
      await pushToolbar(true);
      dispatchTrusted(button('Move toolbar'), new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await vi.waitFor(async () => expect((await storedToolbar()).position).not.toBeNull());
      await pushToolbar(false);
      expect(isHidden()).toBe(true);
      await settle();

      const stored = await storedToolbar();
      expect(Object.keys(stored)).toEqual(['position']);
      await pushToolbar(true);
      expect(isHidden()).toBe(false);
      expect(await storedToolbar()).toEqual(stored);
      expect(toolbar().style.left).toBe(`${stored.position?.x}px`);
      expect(toolbar().style.top).toBe(`${stored.position?.y}px`);
    });

    describe('Hide toolbar', () => {
      const HIDE = 'Hide toolbar on this tab';
      const HIDDEN_NOTICE = 'Toolbar hidden. Turn it back on from the extension popup.';
      const statuses = () => [...shadow().querySelectorAll('[role="status"]')];
      const announcements = () => statuses().filter((status) => !toolbar().contains(status)).map((status) => status.textContent);
      const openNotePanel = async () => {
        const target = document.body.appendChild(document.createElement('div'));
        target.id = 'target';
        dispatchTrusted(target, new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
        await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotation note'));
        return target;
      };
      const turnOn = async () => {
        await toggleCapture();
        await vi.waitFor(() => expect(isAnnotating()).toBe(true));
      };

      it('sends one toolbar.set off, then hides the bar, stops annotating, closes All annotations and answers off for the tab', async () => {
        const send = routeToBackground();
        await start();
        await turnOn();
        trustedClick(button('View all'));
        await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotations on this page'));
        send.mockClear();

        trustedClick(button(HIDE));

        await vi.waitFor(() => expect(isHidden()).toBe(true));
        expect(requests(send, 'toolbar.set')).toEqual([{ type: 'toolbar.set', on: false }]);
        expect(isAnnotating()).toBe(false);
        expect(panel().hasAttribute('aria-label')).toBe(false);
        expect(button('View all').getAttribute('aria-expanded')).toBe('false');
        await expect(readToolbarTab()).resolves.toBe(false);
      });

      it('leaves an open note panel open', async () => {
        routeToBackground();
        await start();
        await turnOn();
        await openNotePanel();

        trustedClick(button(HIDE));

        await vi.waitFor(() => expect(isHidden()).toBe(true));
        expect(panel().getAttribute('aria-label')).toBe('Annotation note');
      });

      it('stays shown, changes nothing and can be clicked again when the request fails, and announces nothing', async () => {
        const send = stubRead(() => Promise.reject(new Error('Storage failed')));
        await start();
        await pushToolbar(true);
        await toggleCapture();
        trustedClick(button('View all'));
        await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotations on this page'));
        send.mockClear();

        trustedClick(button(HIDE));
        await settle();

        expect(requests(send, 'toolbar.set')).toEqual([{ type: 'toolbar.set', on: false }]);
        expect(isHidden()).toBe(false);
        expect(isAnnotating()).toBe(true);
        expect(panel().getAttribute('aria-label')).toBe('Annotations on this page');
        expect(announcements()).not.toContain(HIDDEN_NOTICE);

        trustedClick(button(HIDE));
        await settle();
        expect(requests(send, 'toolbar.set')).toHaveLength(2);
      });

      it('announces that the toolbar is hidden in a live region outside the toolbar', async () => {
        routeToBackground();
        await start();
        await turnOn();
        expect(announcements()).not.toContain(HIDDEN_NOTICE);

        trustedClick(button(HIDE));

        await vi.waitFor(() => expect(announcements()).toContain(HIDDEN_NOTICE));
        expect(statuses().filter((status) => status.textContent === HIDDEN_NOTICE).every((status) => !toolbar().contains(status))).toBe(true);
      });

      it.each([
        ['a toolbar change message', () => pushToolbar(true)],
        ['the capture toggle', () => toggleCapture()],
      ])('shows the bar again at its stored position with every control after %s', async (_name, turnBackOn) => {
        routeToBackground();
        await start();
        dispatchTrusted(button('Move toolbar'), new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await vi.waitFor(async () => expect((await storedToolbar()).position).not.toBeNull());
        await turnOn();
        trustedClick(button(HIDE));
        await vi.waitFor(() => expect(isHidden()).toBe(true));

        await turnBackOn();

        await vi.waitFor(() => expect(isHidden()).toBe(false));
        const stored = await storedToolbar();
        expect(toolbar().style.left).toBe(`${stored.position?.x}px`);
        expect(toolbarButtons()).toEqual(['Move toolbar', 'Scan', 'View all', expect.stringMatching(/Annotate|Stop annotating/), HIDE]);
        for (const control of toolbar().querySelectorAll('button')) expect(control.hidden).toBe(false);
      });
    });

    describe('a click outside the overlay', () => {
      const pointer = (target: EventTarget, init: PointerEventInit & { trusted?: boolean } = {}) => {
        const { trusted = true, ...rest } = init;
        const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0, ...rest });
        if (trusted) dispatchTrusted(target, event);
        else target.dispatchEvent(event);
      };
      const click = (target: EventTarget, init: MouseEventInit & { trusted?: boolean } = {}) => {
        const { trusted = true, ...rest } = init;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1, ...rest });
        if (trusted) dispatchTrusted(target, event);
        else target.dispatchEvent(event);
      };
      const release = (target: EventTarget) =>
        dispatchTrusted(target, new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, button: 0 }));
      const page = () => document.body.appendChild(document.createElement('p'));
      const openNote = async () => {
        await pushToolbar(true);
        const target = document.body.appendChild(document.createElement('div'));
        target.id = 'target';
        await toggleCapture();
        pointer(target);
        await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe('Annotation note'));
      };

      it('closes the note panel for a trusted primary pointerdown and click, and ignores an untrusted pair and a right button', async () => {
        await start();
        await openNote();
        const outside = page();

        pointer(outside, { trusted: false });
        click(outside, { trusted: false });
        expect(panel().getAttribute('aria-label')).toBe('Annotation note');

        pointer(outside, { button: 2 });
        click(outside, { button: 2 });
        expect(panel().getAttribute('aria-label')).toBe('Annotation note');

        pointer(outside);
        click(outside);
        expect(panel().hasAttribute('aria-label')).toBe(false);
      });

      it('keeps the note panel open when the gesture starts inside the overlay and the click lands on the page', async () => {
        await start();
        await openNote();
        const outside = page();

        pointer(panel());
        click(outside);

        expect(panel().getAttribute('aria-label')).toBe('Annotation note');
      });

      it('keeps the note panel open when a press starts on the page and releases inside the overlay, and closes it for the next whole gesture', async () => {
        await start();
        await openNote();
        const outside = page();

        pointer(outside);
        release(panel());
        click(outside);
        expect(panel().getAttribute('aria-label')).toBe('Annotation note');

        pointer(outside);
        release(outside);
        click(outside);
        expect(panel().hasAttribute('aria-label')).toBe(false);
      });

      it('keeps the note panel open for a keyboard-activated click after an outside press that produced no click, and closes it for the next whole gesture', async () => {
        await start();
        await openNote();
        const outside = page();

        pointer(outside);
        click(outside, { detail: 0 });
        expect(panel().getAttribute('aria-label')).toBe('Annotation note');

        pointer(outside);
        release(outside);
        click(outside);
        expect(panel().hasAttribute('aria-label')).toBe(false);
      });

      it.each([
        ['All annotations', 'View all', 'Annotations on this page'],
        ['the scan panel', 'Scan', 'Page scan'],
      ])('closes %s on a trusted outside click', async (_name, opener, label) => {
        await start();
        await pushToolbar(true);
        trustedClick(button(opener));
        await vi.waitFor(() => expect(panel().getAttribute('aria-label')).toBe(label));
        const outside = page();

        pointer(outside);
        click(outside);

        expect(panel().hasAttribute('aria-label')).toBe(false);
        expect(button(opener).getAttribute('aria-expanded')).toBe('false');
      });
    });
  });
});
