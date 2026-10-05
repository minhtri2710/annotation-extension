import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import contentScript from '../../entrypoints/content';
import type { Annotation } from '../annotation';
import { addAnnotation } from '../annotation-storage';
import type { ElementContext } from '../capture/context';
import { createCaptureController, guardUntrustedOverlayEvents, interceptPageEvents, releasePageEvents, type CaptureController, type CaptureEvents } from '../capture/selection';
import { extractElementContext } from '../capture/context';
import { watchOutsideClick } from '../ui/outside-click';
import { createAnnotationList } from '../annotation-list/annotation-list';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { createNotePanel, NOTE_PANEL_CLOSE_EVENT } from '../notes/note-panel';
import { buildOverlayShell, createPanelAnchor } from '../ui/shell';
import { createPanelMode } from './panel-mode';
import { registerBackgroundMessageHandlers } from './background-messages';
import { createPinsController, type PinsController } from '../pins/pins';
import { createEventBus } from '../ui/event-bus';

let host: HTMLElement;
let root: ShadowRoot;
let stopOverlayGuard: (() => void) | undefined;
let target: HTMLElement;
let controller: CaptureController | undefined;
let pins: PinsController | undefined;
let selected: ElementContext[];

function mountHost() {
  host = document.createElement('div');
  root = host.attachShadow({ mode: 'closed' });
  stopOverlayGuard = guardUntrustedOverlayEvents(root);
  document.body.append(host);
  host.popover = 'manual';
  host.showPopover();
}

function startCapture() {
  selected = [];
  const bus = createEventBus<CaptureEvents>();
  bus.on('element:selected', (context) => selected.push(context));
  controller = createCaptureController({ document, shadowHost: host, shadowRoot: root, bus });
  controller.activate();
}

async function hover(element: Element) {
  await userEvent.hover(element);
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
  stopOverlayGuard?.();
  stopOverlayGuard = undefined;
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

  it('the capture highlight covers its element within 2 px', async () => {
    startCapture();
    await hover(target);

    const box = root.querySelector<HTMLElement>('[data-annotation-highlight]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expect(expected.width).toBeCloseTo(225, 0);
    expectWithin(box.left, expected.left);
    expectWithin(box.top, expected.top);
    expectWithin(box.width, expected.width);
    expectWithin(box.height, expected.height);
  });

  it("the highlight label sits on the element's top edge", async () => {
    startCapture();
    await hover(target);

    const label = root.querySelector<HTMLElement>('[data-annotation-highlight-label]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expectWithin(label.left, expected.left);
    expectWithin(label.bottom, expected.top);
  });

  it("a pin is centred on its element's top-left corner within 2 px", () => {
    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    root.append(container, toolbar);
    pins = createPinsController({ document, container, toolbar, badgeHost: toolbar.appendChild(document.createElement('button')) });
    pins.setAnnotations([annotation('#zoom-target')]);

    const marker = container.querySelector<HTMLElement>('[data-annotation-id]')!.getBoundingClientRect();
    const expected = target.getBoundingClientRect();
    expectWithin(marker.left + marker.width / 2, expected.left);
    expectWithin(marker.top + marker.height / 2, expected.top);
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
    await userEvent.click(outside);
    startCapture();

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
    interceptPageEvents(window);
    pageSaw = [];
    for (const type of HOSTILE) window.addEventListener(type, hostile, true);
  });

  afterEach(() => {
    for (const type of HOSTILE) window.removeEventListener(type, hostile, true);
  });

  it('keeps overlay button keyboard activation working through a closed root while capture is active', async () => {
    const button = document.createElement('button');
    button.textContent = 'Overlay';
    host.style.cssText = 'position: fixed; inset: 0';
    button.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    let overlayClicks = 0;
    button.addEventListener('click', () => overlayClicks++);
    root.append(button);
    startCapture();

    await userEvent.click(host);
    expect(overlayClicks).toBe(1);
    button.focus();
    await userEvent.keyboard(' ');
    expect(overlayClicks).toBe(2);
    expect(controller!.active).toBe(true);
    host.hidePopover();

    await userEvent.click(target);
    expect(selected.map((context) => context.id)).toEqual(['zoom-target']);
  });

  it('routes capture navigation keys from a focused control inside the closed root', async () => {
    const parent = document.createElement('div');
    parent.id = 'key-parent';
    parent.style.cssText = 'width: 200px; height: 100px';
    const child = document.createElement('button');
    child.textContent = 'Page target';
    child.style.cssText = 'width: 100px; height: 40px';
    parent.append(child);
    document.body.append(parent);
    const overlayButton = document.createElement('button');
    overlayButton.tabIndex = 0;
    root.append(overlayButton);
    startCapture();

    await userEvent.hover(child);
    overlayButton.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(root.querySelector('[data-annotation-highlight-label]')?.textContent).toContain('div#key-parent');

    await userEvent.keyboard('{Escape}');
    expect(controller!.active).toBe(false);
    parent.remove();
  });

  it('blocks untrusted events from the closed-root list and permits trusted clear controls', async () => {
    const container = document.createElement('div');
    root.append(container);
    const shell = buildOverlayShell(container);
    const sendAnnotationWrite = vi.fn(async (_message: AnnotationWriteMessage) => undefined);
    const storedAnnotations = [annotation('#first'), { ...annotation('#second'), id: 'second', note: 'Second note' }];
    const list = createAnnotationList(shell.panel, location.href, {
      listAnnotations: async () => storedAnnotations,
      sendAnnotationWrite: async (message) => {
        sendAnnotationWrite(message);
        if (message.type === 'annotation.clear') storedAnnotations.splice(0);
        if (message.type === 'annotation.delete') {
          const index = storedAnnotations.findIndex((item) => item.id === message.id);
          if (index >= 0) storedAnnotations.splice(index, 1);
        }
      },
      readBlob: async () => new Blob(),
      readOnboardingOpen: async () => false,
      readCaptureShortcut: async () => 'Alt+Q',
      writeOnboardingOpen: async () => undefined,
    });
    await list.render();
    const viewAll = document.createElement('button');
    viewAll.type = 'button';
    viewAll.dataset.annotationListToggle = '';
    viewAll.setAttribute('aria-expanded', 'false');
    viewAll.textContent = 'View all';
    const openList = vi.fn(() => {
      void list.render().then(() => viewAll.setAttribute('aria-expanded', 'true'));
    });
    viewAll.addEventListener('click', openList);
    shell.toolbar.append(viewAll);
    host.style.cssText = 'position: fixed; inset: 0';
    const rows = shell.panel.querySelector('[data-annotation-rows]')!;
    const before = rows.textContent;
    const remove = shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!;
    const clear = shell.panel.querySelector('[data-annotation-clear]')!;
    for (const type of HOSTILE) window.removeEventListener(type, hostile, true);
    const leakedTargets: EventTarget[] = [host, document, window, viewAll, clear, remove];
    for (const item of leakedTargets) {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
      if (item instanceof HTMLElement) item.click();
    }
    expect(openList).not.toHaveBeenCalled();
    expect(shell.panel.querySelector('[data-annotation-clear]')).toBe(clear);
    expect(shell.panel.querySelector('[data-annotation-clear-confirm]')).toBeNull();
    expect(shell.panel.querySelector('[data-annotation-delete-confirm]')).toBeNull();
    expect(shell.panel.querySelector('[data-annotation-row]')).toBe(remove.closest('[data-annotation-row]'));
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect(rows.textContent).toBe(before);

    startCapture();
    viewAll.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await userEvent.click(host);
    await vi.waitFor(() => expect(viewAll.getAttribute('aria-expanded')).toBe('true'));
    expect(openList).toHaveBeenCalledTimes(1);
    viewAll.style.removeProperty('position');
    viewAll.style.removeProperty('inset');
    viewAll.style.removeProperty('width');
    viewAll.style.removeProperty('height');
    const clickInPanel = async () => {
      const box = shell.panel.getBoundingClientRect();
      host.style.cssText = `position: fixed; margin: 0; inset: auto; left: ${box.left + box.width / 2 - 7}px; top: ${box.top + box.height / 2 - 7}px; width: 14px; height: 14px`;
      await userEvent.click(host);
    };
    const currentRemove = shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!;
    currentRemove.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await clickInPanel();
    const deletePrompt = shell.panel.querySelector('[data-annotation-delete-prompt]')!;
    const deleteConfirm = deletePrompt.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement;
    deleteConfirm.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    deleteConfirm.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await clickInPanel();
    expect(sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.delete', pageUrl: location.href, id: 'zoomed' });

    const currentClear = shell.panel.querySelector('[data-annotation-clear]') as HTMLButtonElement;
    currentClear.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await clickInPanel();
    const clearPrompt = shell.panel.querySelector('[data-annotation-clear-prompt]')!;
    const confirm = clearPrompt.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(sendAnnotationWrite).not.toHaveBeenCalledWith({ type: 'annotation.clear', pageUrl: location.href });
    confirm.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await clickInPanel();
    expect(sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.clear', pageUrl: location.href });
    await list.clear();
  });

  it('ignores untrusted page capture events but commits a trusted click', async () => {
    startCapture();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, button: 0 }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selected).toEqual([]);
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

const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;
let contentContext: ContentScriptContext | undefined;
let attachShadowSpy: MockInstance | undefined;

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function startContentScript() {
  await page.viewport(1280, 720);
  fakeBrowser.reset();
  registerBackgroundMessageHandlers({ blobStore: { get: async () => undefined, put: async () => undefined, delete: async () => undefined } });
  attachShadowSpy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const shadow = originalAttachShadow.call(this, init);
    attachedRoots.set(this, shadow);
    return shadow;
  });
  contentContext = new ContentScriptContext('content', { noScriptStartedPostMessage: true });
  await contentScript.main(contentContext);
  await fakeBrowser.runtime.onMessage.trigger({ type: 'toolbar.changed', on: true }, {}, () => {});
  const overlayRoot = attachedRoots.get(document.querySelector('annotation-extension-root')!)!;
  const nameOf = (control: Element) => control.getAttribute('aria-label') ?? control.textContent;
  const button = (name: string) => [...overlayRoot.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((candidate) => nameOf(candidate) === name)!;
  const panel = () => overlayRoot.querySelector<HTMLElement>('[role="region"]')!;
  const overlayHost = document.querySelector<HTMLElement>('annotation-extension-root')!;
  const pointIn = (element: Element) => {
    const box = element.getBoundingClientRect();
    const origin = overlayHost.getBoundingClientRect();
    return { x: box.left + box.width / 2 - origin.left, y: box.top + box.height / 2 - origin.top };
  };
  // Playwright cannot locate inside a closed root, so a real pointer goes to the overlay element's coordinates through the host.
  const click = (element: Element) => userEvent.click(overlayHost, { position: pointIn(element), force: true });
  const dragFromOverlay = (element: Element, to: Element) => userEvent.dragAndDrop(overlayHost, to, { sourcePosition: pointIn(element), force: true });
  const dragToOverlay = (from: Element, element: Element) => userEvent.dragAndDrop(from, overlayHost, { targetPosition: pointIn(element), force: true });
  return { overlayRoot, overlayHost, button, panel, label: () => panel().getAttribute('aria-label'), click, dragFromOverlay, dragToOverlay };
}

afterEach(() => {
  contentContext?.notifyInvalidated();
  contentContext = undefined;
  attachShadowSpy?.mockRestore();
  attachShadowSpy = undefined;
});

describe('closing a note panel after Save near the toolbar (real browser)', () => {
  it('leaves the panel unclamped with Close in view and clickable after Save grows a panel that started clamped', async () => {
    const { overlayRoot, button, panel, label, click } = await startContentScript();
    const footer = document.createElement('div');
    footer.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; height: 40px; background: #ccc';
    const near = document.createElement('p');
    document.body.append(footer, near);
    const closed = vi.fn();
    try {
      await click(button('Annotate'));
      await userEvent.click(target);
      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-new-note]')).not.toBeNull());
      await frames();
      const bare = panel().offsetHeight;
      const barRect = overlayRoot.querySelector('[role="toolbar"]')!.getBoundingClientRect();
      const box = { x: barRect.left + 10, y: barRect.top - 10 - (bare - 40) - 8 - 20, width: 100, height: 20 };
      near.style.cssText = `position: fixed; margin: 0; left: ${box.x}px; top: ${box.y}px; width: ${box.width}px; height: ${box.height}px`;
      panel().addEventListener(NOTE_PANEL_CLOSE_EVENT, closed);

      await click(button('Annotate'));
      await userEvent.click(near);
      await vi.waitFor(() => expect(panel().querySelector('[data-annotation-new-note]')).not.toBeNull());
      await frames();

      const field = panel().querySelector<HTMLTextAreaElement>('[data-annotation-new-note]')!;
      field.value = 'A saved note';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await click(panel().querySelector<HTMLButtonElement>('[data-annotation-save]')!);
      await vi.waitFor(() => expect(panel().querySelectorAll('[data-annotation-note-card]')).toHaveLength(1));
      await frames();

      const panelRect = panel().getBoundingClientRect();
      expect(panel().scrollHeight).toBeLessThanOrEqual(panel().clientHeight + 1);
      const close = panel().querySelector<HTMLButtonElement>('[data-annotation-close]')!;
      const rect = close.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(panelRect.top);
      expect(rect.bottom).toBeLessThanOrEqual(panelRect.bottom);
      expect(overlayRoot.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(close);
      await click(close);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(label()).toBeNull();
    } finally {
      footer.remove();
      near.remove();
    }
  });
});

describe('a click outside the note form (real browser)', () => {
  let fixtures: HTMLElement[] = [];

  afterEach(() => {
    for (const fixture of fixtures) fixture.remove();
    fixtures = [];
  });

  async function mountScene() {
    const { overlayRoot, overlayHost, button, panel, label, click, dragFromOverlay, dragToOverlay } = await startContentScript();
    const placed =(element: HTMLElement, style: string) => {
      element.style.cssText = `position: fixed; margin: 0; ${style}`;
      document.body.append(element);
      fixtures.push(element);
      return element;
    };
    const outside = placed(document.createElement('button'), 'left: 900px; top: 20px; width: 120px; height: 32px');
    outside.textContent = 'Page control';
    const second = placed(document.createElement('p'), 'left: 900px; top: 200px; width: 150px; height: 20px');
    second.id = 'second-target';
    const field = () => panel().querySelector<HTMLTextAreaElement>('[data-annotation-new-note]');
    const openFormFor = async (element: Element) => {
      await click(button('Annotate'));
      await userEvent.click(element);
      await vi.waitFor(() => expect(field()).not.toBeNull());
      await frames();
    };
    return { overlayRoot, overlayHost, button, panel, label, click, dragFromOverlay, dragToOverlay, outside, second, field, openFormFor };
  }

  it('closes the form on a real click on page content outside the overlay, and keeps it for a click inside the form', async () => {
    const { panel, outside, label, field, click, openFormFor } = await mountScene();
    await openFormFor(target);

    await click(field()!);
    await frames();
    expect(label()).toBe('Annotation note');

    await userEvent.click(outside);
    await vi.waitFor(() => expect(label()).toBeNull());
    expect(panel().childElementCount).toBe(0);
  });

  it('opens the note of a clicked pin, and View all switches to All annotations', async () => {
    const { overlayRoot, button, panel, label, click, second, field, openFormFor } = await mountScene();
    await addAnnotation(location.href, { note: 'zoomed', selector: '#second-target', elementContext: extractElementContext(second) });
    await vi.waitFor(() => expect(overlayRoot.querySelector('.annotation-pin')).not.toBeNull());
    await openFormFor(target);
    const hint = () => panel().querySelector<HTMLElement>('[data-annotation-hint]')?.title;
    expect(hint()).toBe('#zoom-target');

    await click(overlayRoot.querySelector<HTMLElement>('.annotation-pin')!);
    await vi.waitFor(() => expect(hint()).toBe('#second-target'));
    expect(label()).toBe('Annotation note');
    expect(field()).not.toBeNull();

    await click(button('View all'));
    await vi.waitFor(() => expect(label()).toBe('Annotations on this page'));
    expect(button('View all').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the form a click selects open when the watcher after', async () => {
    const { panel, button, label, click, second, field, openFormFor } = await mountScene();
    await openFormFor(target);
    await click(button('Annotate'));

    await userEvent.click(second);
    await vi.waitFor(() => expect(panel().querySelector<HTMLElement>('[data-annotation-hint]')?.title).toBe('#second-target'));
    await frames();

    expect(label()).toBe('Annotation note');
    expect(field()).not.toBeNull();
  });

  it('keeps the form a click selects open when the watcher before', async () => {
    const sceneHost = document.createElement('div');
    const sceneRoot = sceneHost.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    sceneRoot.append(container);
    document.body.append(sceneHost);
    sceneHost.popover = 'manual';
    sceneHost.showPopover();
    const shell = buildOverlayShell(container);
    const second = document.createElement('p');
    second.id = 'second-target';
    second.style.cssText = 'position: fixed; margin: 0; left: 900px; top: 200px; width: 150px; height: 20px';
    document.body.append(second);
    const opener = document.createElement('button');
    shell.toolbar.append(opener);
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [],
      sendAnnotationWrite: async () => undefined,
      captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    const panels = createPanelMode({
      panel: shell.panel,
      overlayRoot: sceneRoot,
      anchor,
      anchorToToolbar: () => shell.toolbar.getBoundingClientRect(),
      notePanel,
      scanPanel: { render: async () => undefined, clear: () => undefined, suspend: () => undefined, restore: () => undefined },
      annotationList: () => ({ render: async () => undefined, clear: () => undefined }),
      listToggle: document.createElement('button'),
      scanToggle: document.createElement('button'),
    });
    const bus = createEventBus<CaptureEvents>();
    bus.on('element:selected', (context) => panels.showNote(context, opener));
    // The content script always registers the watcher after the capture listeners, so this order has no real-script form.
    releasePageEvents(window);
    const stopWatching = watchOutsideClick({ win: window, shadowHost: sceneHost, panels, captureActive: () => controller?.active ?? false });
    try {
      panels.showNote(extractElementContext(target), opener);
      await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-new-note]')).not.toBeNull());
      await frames();
      controller = createCaptureController({ document, shadowHost: sceneHost, shadowRoot: sceneRoot, bus });
      controller.activate();

      await userEvent.click(second);
      await vi.waitFor(() => expect(shell.panel.querySelector<HTMLElement>('[data-annotation-hint]')?.title).toBe('#second-target'));
      await frames();

      expect(shell.panel.getAttribute('aria-label')).toBe('Annotation note');
      expect(shell.panel.querySelector('[data-annotation-new-note]')).not.toBeNull();
    } finally {
      stopWatching();
      releasePageEvents(window);
      notePanel.teardown();
      anchor.destroy();
      sceneHost.remove();
      second.remove();
    }
  });

  it('keeps the form open for a drag that starts in its field and ends on the page', async () => {
    const { outside, label, field, dragFromOverlay, openFormFor } = await mountScene();
    await openFormFor(target);
    field()!.value = 'Some note text to select';
    field()!.dispatchEvent(new Event('input', { bubbles: true }));

    await dragFromOverlay(field()!, outside);
    await frames();

    expect(label()).toBe('Annotation note');
  });

  it('keeps the note panel open when a press starts on page content and releases inside the overlay', async () => {
    const { outside, label, field, dragToOverlay, openFormFor } = await mountScene();
    await openFormFor(target);
    field()!.value = 'Typed before the gesture';
    field()!.dispatchEvent(new Event('input', { bubbles: true }));

    await dragToOverlay(outside, field()!);
    await frames();

    expect(label()).toBe('Annotation note');
    expect(field()!.value).toBe('Typed before the gesture');
  });

  it('keeps the note form open after an outside press with no click followed by a keyboard-activated click', async () => {
    const { outside, second, label, openFormFor } = await mountScene();
    await openFormFor(target);
    const dragLink = document.createElement('a');
    dragLink.href = '#drag-source';
    dragLink.textContent = 'Drag me';
    dragLink.style.cssText = 'position: fixed; left: 900px; top: 120px; width: 120px; height: 20px';
    document.body.append(dragLink);
    const clicks: Event[] = [];
    const record = (event: Event) => clicks.push(event);
    window.addEventListener('click', record, true);
    try {
      await userEvent.dragAndDrop(dragLink, second);
      await frames();
      expect(clicks).toEqual([]);

      outside.focus();
      await userEvent.keyboard('{Enter}');
      await frames();
      expect(clicks).toHaveLength(1);
      expect(clicks[0]).toMatchObject({ target: outside, detail: 0, isTrusted: true });
      expect(label()).toBe('Annotation note');

      await userEvent.click(outside);
      await vi.waitFor(() => expect(label()).toBeNull());
    } finally {
      window.removeEventListener('click', record, true);
      dragLink.remove();
    }
  });

  it('leaves focus where the click put it, on a focusable page control and on one that keeps the focus in the form', async () => {
    const { overlayRoot, overlayHost, button, outside, label, field, openFormFor } = await mountScene();
    const openerFocus = vi.fn();
    await openFormFor(target);
    button('Annotate').addEventListener('focus', openerFocus);
    field()!.focus();

    await userEvent.click(outside);
    await vi.waitFor(() => expect(label()).toBeNull());
    expect(document.activeElement).toBe(outside);
    expect(openerFocus).not.toHaveBeenCalled();

    await openFormFor(target);
    openerFocus.mockClear();
    field()!.focus();
    const keeper = document.createElement('button');
    keeper.style.cssText = 'position: fixed; left: 900px; top: 80px; width: 120px; height: 32px';
    keeper.textContent = 'Keeps focus';
    keeper.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.append(keeper);
    try {
      expect(overlayRoot.activeElement).toBe(field());

      await userEvent.click(keeper);
      await vi.waitFor(() => expect(label()).toBeNull());

      expect(document.activeElement).not.toBe(overlayHost);
      expect(openerFocus).not.toHaveBeenCalled();
    } finally {
      keeper.remove();
    }
  });

  it('keeps unsaved text through the close, and shows it with "Draft restored." when the same form opens again', async () => {
    const { panel, outside, label, click, field, openFormFor } = await mountScene();
    await openFormFor(target);
    await click(field()!);
    await userEvent.keyboard('Keep this draft');

    await userEvent.click(outside);
    await vi.waitFor(() => expect(label()).toBeNull());
    await openFormFor(target);

    expect(field()!.value).toBe('Keep this draft');
    expect(panel().textContent).toContain('Draft restored.');
  });
});

describe('Annotate from a scan finding (real browser)', () => {
  let fixtures: HTMLElement[] = [];

  afterEach(() => {
    for (const fixture of fixtures) fixture.remove();
    fixtures = [];
    window.scrollTo(0, 0);
  });

  async function mountScan() {
    const { overlayRoot, button, panel, label, click } = await startContentScript();
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height: 3000px';
    const elements = [300, 420].map((top, index) => {
      const element = document.createElement('img');
      element.id = `scan-target-${index}`;
      element.style.cssText = `position: absolute; margin: 0; top: ${top}px; right: ${80 + 40 * index}px; width: 150px; height: 30px`;
      return element;
    });
    const outside = document.createElement('button');
    outside.textContent = 'Page control';
    outside.style.cssText = 'position: fixed; margin: 0; left: 20px; top: 20px; width: 120px; height: 32px';
    document.body.append(spacer, ...elements, outside);
    fixtures.push(spacer, ...elements, outside);
    const outlines = () => [...overlayRoot.querySelectorAll<HTMLElement>('[data-annotation-scan-outline]')];
    const annotateButtons = () => [...panel().querySelectorAll<HTMLButtonElement>('[data-annotation-scan-annotate]')];
    const field = () => panel().querySelector<HTMLTextAreaElement>('[data-annotation-new-note]');
    const openScan = async () => {
      await click(button('Scan'));
      await vi.waitFor(() => expect(annotateButtons()).toHaveLength(2));
      await frames();
    };
    const annotate = async (index: number) => {
      await click(annotateButtons()[index]!);
      await vi.waitFor(() => expect(field()).not.toBeNull());
      await frames();
    };
    const expectCovers = (box: HTMLElement, element: Element) => {
      const actual = box.getBoundingClientRect();
      const expected = element.getBoundingClientRect();
      expectWithin(actual.left, expected.left);
      expectWithin(actual.top, expected.top);
      expectWithin(actual.width, expected.width);
      expectWithin(actual.height, expected.height);
    };
    return { overlayRoot, panel, click, outside, elements, label, outlines, annotateButtons, field, openScan, annotate, expectCovers };
  }

  it('keeps the annotated finding\'s box on its element through a page scroll and a viewport resize', async () => {
    const { elements, outlines, openScan, annotate, expectCovers } = await mountScan();
    await openScan();
    await annotate(1);

    expect(outlines()).toHaveLength(1);
    expectCovers(outlines()[0]!, elements[1]!);

    window.scrollTo(0, 150);
    await vi.waitFor(() => expect(window.scrollY).toBe(150));
    await frames();
    expect(elements[1]!.getBoundingClientRect().top).toBeCloseTo(270, 0);
    expectCovers(outlines()[0]!, elements[1]!);

    await page.viewport(900, 600);
    await frames();
    expectCovers(outlines()[0]!, elements[1]!);
  });

  it('brings the scan back after a real Add note click, with every box on its element', async () => {
    const { panel, click, elements, label, outlines, annotateButtons, field, openScan, annotate, expectCovers } = await mountScan();
    await openScan();
    await annotate(0);

    await click(field()!);
    await userEvent.keyboard(' typed');
    await click(panel().querySelector<HTMLButtonElement>('[data-annotation-save]')!);

    await vi.waitFor(() => expect(label()).toBe('Page scan'));
    await frames();
    expect(annotateButtons()).toHaveLength(2);
    expect(outlines()).toHaveLength(2);
    outlines().forEach((box, index) => {
      expect(box.hidden).toBe(false);
      expectCovers(box, elements[index]!);
    });
  });

  it('leaves focus on the page control a real outside click landed on, and brings the scan back', async () => {
    const { overlayRoot, outside, label, outlines, annotateButtons, openScan, annotate } = await mountScan();
    await openScan();
    await annotate(0);

    await userEvent.click(outside);

    await vi.waitFor(() => expect(label()).toBe('Page scan'));
    expect(outlines()).toHaveLength(2);
    expect(document.activeElement).toBe(outside);
    expect(annotateButtons()).not.toContain(overlayRoot.activeElement);
  });
});
