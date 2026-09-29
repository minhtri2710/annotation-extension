import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createCaptureController, guardUntrustedOverlayEvents, interceptPageEvents, type CaptureController, type CaptureEvents } from '../capture/selection';
import { createAnnotationList } from '../annotation-list/annotation-list';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { buildOverlayShell } from '../ui/shell';
import { createPinsController, type PinsController } from '../pins/pins';
import { createEventBus } from '../ui/event-bus';

let host: HTMLElement;
let root: ShadowRoot;
let stopOverlayGuard: (() => void) | undefined;
let target: HTMLElement;
let controller: CaptureController | undefined;
let pins: PinsController | undefined;
let selected: ElementContext[];

// The overlay host as the content script mounts it: a shadow host raised into the top layer.
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
    pins = createPinsController({ document, container, toolbar });
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
    const currentRemove = shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!;
    currentRemove.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await userEvent.click(host);
    const deletePrompt = shell.panel.querySelector('[data-annotation-delete-prompt]')!;
    const deleteConfirm = deletePrompt.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement;
    deleteConfirm.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    deleteConfirm.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await userEvent.click(host);
    expect(sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.delete', pageUrl: location.href, id: 'zoomed' });

    const currentClear = shell.panel.querySelector('[data-annotation-clear]') as HTMLButtonElement;
    currentClear.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await userEvent.click(host);
    const clearPrompt = shell.panel.querySelector('[data-annotation-clear-prompt]')!;
    const confirm = clearPrompt.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(sendAnnotationWrite).not.toHaveBeenCalledWith({ type: 'annotation.clear', pageUrl: location.href });
    confirm.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    await userEvent.click(host);
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
