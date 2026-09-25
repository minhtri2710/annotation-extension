import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createCaptureController } from '../capture/selection';
import { createAnnotationList } from '../annotation-list/annotation-list';
import { createNotePanel } from '../notes/note-panel';
import { createPinsController } from '../pins/pins';
import { createLocateHighlight } from './locate-highlight';
import { buildOverlayShell, createPanelAnchor, raiseOverlay } from './shell';
import { createToolbarControls } from './toolbar-controls';

declare module 'vitest' {
  export interface ProvidedContext {
    classicScrollbars?: boolean;
  }
}

const pageUrl = 'https://example.com/article';
const cleanups: (() => void)[] = [];

// Mirrors content.ts: WXT's shadow host with its `:host{all:initial !important}` reset, raised by raiseOverlay.
function mountOverlay() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  reset.textContent = ':host{all:initial !important;}';
  const container = document.createElement('div');
  shadow.append(reset, container);
  const shell = buildOverlayShell(container);
  raiseOverlay(host);
  // The production toolbar's controls, so its width at small viewports is realistic.
  const [annotate] = ['Annotate', 'Move toolbar', 'Scan', 'View all', 'Collapse toolbar'].map((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    shell.toolbar.append(button);
    return button;
  });
  const badge = document.createElement('span');
  badge.textContent = '12 annotations';
  shell.toolbar.append(badge);
  return { host, shadow, shell, annotate: annotate! };
}

function addPageStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  cleanups.push(() => style.remove());
}

function context(box = { x: 40, y: 100, width: 100, height: 30 }): ElementContext {
  return {
    selector: '#target', tagName: 'DIV', id: 'target', classList: [], text: '',
    boundingBox: box, url: pageUrl, viewport: { width: 1280, height: 720 }, sourcePath: null,
  };
}

function annotation(id: string, note: string, selector = '#target'): Annotation {
  return {
    id, pageUrl, note, selector, elementContext: context(),
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'open',
    repro: { steps: ['open the page', 'click'], expected: 'works', actual: 'breaks' },
  };
}

function notePanelFor(panel: HTMLElement, stored: Annotation[]) {
  return createNotePanel(panel, {
    listAnnotations: async () => [...stored],
    sendAnnotationWrite: vi.fn(async () => undefined),
    captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
    applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
  });
}

function viewportSize() {
  return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

function expectInsideViewport(rect: DOMRect): void {
  const { width, height } = viewportSize();
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(width);
  expect(rect.bottom).toBeLessThanOrEqual(height);
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

afterEach(async () => {
  while (cleanups.length > 0) cleanups.pop()!();
  document.documentElement.style.removeProperty('font-size');
  document.body.replaceChildren();
  window.scrollTo(0, 0);
  await page.viewport(1280, 720);
});

const HOSTILE = {
  'body transform': 'body { transform: translateZ(0); margin: 30px; }',
  'body filter': 'body { filter: saturate(1); margin: 30px; }',
  'body contain: paint': 'body { contain: paint; margin: 30px; }',
  'body contain: layout': 'body { contain: layout; margin: 30px; }',
  'body will-change: transform': 'body { will-change: transform; margin: 30px; }',
  'html transform': 'html { transform: translateZ(0); } body { margin: 30px; }',
};

describe('overlay layout on hostile pages (real browser)', () => {
  for (const [name, css] of Object.entries(HOSTILE)) {
    it(`places the toolbar, highlights and pins against the viewport with ${name}`, async () => {
      await page.viewport(1280, 720);
      addPageStyle(css);
      const main = document.createElement('main');
      main.style.height = '2000px';
      const target = document.createElement('div');
      target.id = 'target';
      target.style.cssText = 'margin: 500px 0 0 200px; width: 160px; height: 60px; background: #ddd;';
      main.append(target);
      document.body.append(main);
      const { host, shadow, shell } = mountOverlay();
      window.scrollTo(0, 300);
      await nextFrame();

      expectInsideViewport(shell.toolbar.getBoundingClientRect());
      const targetRect = target.getBoundingClientRect();

      const locate = createLocateHighlight();
      cleanups.push(() => locate.remove());
      locate.show(shell.root, target);
      const located = target.getBoundingClientRect();
      const locateRect = shell.root.querySelector('[data-annotation-scan-highlight]')!.getBoundingClientRect();
      expect(Math.abs(locateRect.left - located.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(locateRect.top - located.top)).toBeLessThanOrEqual(1);
      locate.remove();
      window.scrollTo(0, 300);
      await nextFrame();

      const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
      cleanups.push(() => pins.destroy());
      pins.setAnnotations([annotation('a1', 'note')]);
      pins.reanchor();
      const pin = center(shell.root.querySelector('.annotation-pin')!.getBoundingClientRect());
      expect(Math.abs(pin.x - targetRect.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(pin.y - targetRect.top)).toBeLessThanOrEqual(1);

      const capture = createCaptureController({ document, shadowHost: host });
      cleanups.push(() => capture.destroy());
      capture.activate();
      await userEvent.hover(target);
      const highlight = shadow.querySelector<HTMLElement>('[data-annotation-highlight]')!;
      await vi.waitFor(() => expect(highlight.hidden).toBe(false));
      const highlightRect = highlight.getBoundingClientRect();
      expect(Math.abs(highlightRect.left - targetRect.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(highlightRect.top - targetRect.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(highlightRect.width - targetRect.width)).toBeLessThanOrEqual(1);
    });
  }

  it('keeps the toolbar clickable above a page layer at z-index 2147483647', async () => {
    const cover = document.createElement('div');
    cover.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: rgba(255, 0, 0, 0.2);';
    const { host, shadow, annotate } = mountOverlay();
    document.body.append(cover);
    const clicked = vi.fn();
    annotate.addEventListener('click', clicked);

    const point = center(annotate.getBoundingClientRect());
    expect(document.elementFromPoint(point.x, point.y)).toBe(host);
    expect(shadow.elementFromPoint(point.x, point.y)).toBe(annotate);
    await userEvent.click(annotate);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('lets a page modal dialog and a page popover work, and is usable again once the dialog closes', async () => {
    const { host, annotate } = mountOverlay();
    const dialog = document.createElement('dialog');
    const inside = document.createElement('button');
    inside.textContent = 'Dialog action';
    dialog.append(inside);
    const popover = document.createElement('div');
    popover.popover = 'auto';
    popover.textContent = 'Page popover';
    document.body.append(dialog, popover);
    const dialogClicked = vi.fn();
    inside.addEventListener('click', dialogClicked);

    dialog.showModal();
    expect(dialog.matches(':modal')).toBe(true);
    await userEvent.click(inside);
    expect(dialogClicked).toHaveBeenCalledTimes(1);
    // While the page's modal is open the overlay sits under it and is inert, like the rest of the page.
    const point = center(annotate.getBoundingClientRect());
    expect(document.elementFromPoint(point.x, point.y)).not.toBe(host);
    dialog.close();

    popover.showPopover();
    expect(popover.matches(':popover-open')).toBe(true);
    const popoverPoint = center(popover.getBoundingClientRect());
    expect(document.elementFromPoint(popoverPoint.x, popoverPoint.y)).toBe(popover);
    popover.hidePopover();

    expect(host.matches(':popover-open')).toBe(true);
    expect(document.elementFromPoint(point.x, point.y)).toBe(host);
  });
});

describe('overlay sizing ignores the page root font size (real browser)', () => {
  function measure() {
    const { shell } = mountOverlay();
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';
    const text = document.createElement('p');
    text.textContent = 'A note about the element under review.';
    shell.panel.append(heading, text);
    const sizes = {
      toolbar: shell.toolbar.getBoundingClientRect(),
      panel: shell.panel.getBoundingClientRect(),
      text: parseFloat(getComputedStyle(text).fontSize),
      heading: heading.getBoundingClientRect().height,
    };
    document.body.replaceChildren();
    return sizes;
  }

  it('gives a 10 px and a 24 px root the same overlay box and text sizes as a 16 px root', async () => {
    await page.viewport(1280, 720);
    document.documentElement.style.fontSize = '16px';
    const base = measure();
    for (const size of ['10px', '24px']) {
      document.documentElement.style.fontSize = size;
      const other = measure();
      expect(Math.abs(other.toolbar.width - base.toolbar.width), size).toBeLessThanOrEqual(1);
      expect(Math.abs(other.toolbar.height - base.toolbar.height), size).toBeLessThanOrEqual(1);
      expect(Math.abs(other.panel.width - base.panel.width), size).toBeLessThanOrEqual(1);
      expect(Math.abs(other.panel.height - base.panel.height), size).toBeLessThanOrEqual(1);
      expect(Math.abs(other.text - base.text), size).toBeLessThanOrEqual(1);
      expect(Math.abs(other.heading - base.heading), size).toBeLessThanOrEqual(1);
    }
  });
});

describe('panels stay inside small viewports (real browser)', () => {
  const VIEWPORTS: [number, number][] = [[320, 568], [600, 400]];

  for (const [width, height] of VIEWPORTS) {
    it(`keeps the note panel inside a ${width}x${height} viewport with every control reachable by pointer and Tab`, async () => {
      await page.viewport(width, height);
      const { shadow, shell } = mountOverlay();
      const stored = [annotation('a1', 'First note'), annotation('a2', 'Second note')];
      const notePanel = notePanelFor(shell.panel, stored);
      cleanups.push(() => notePanel.teardown());
      const anchor = createPanelAnchor(shell.panel, shell.toolbar);
      cleanups.push(() => anchor.destroy());
      await notePanel.render(context());
      anchor.place(() => ({ x: 40, y: 100, width: 100, height: 30 }));
      await nextFrame();

      expectInsideViewport(shell.panel.getBoundingClientRect());
      expectInsideViewport(shell.toolbar.getBoundingClientRect());

      const controls = [
        shell.panel.querySelector<HTMLElement>('[data-annotation-close]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-new-note]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-save]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-repro-save]')!,
      ];
      for (const control of controls) expect(control).not.toBeNull();

      const reached = new Set<HTMLElement>();
      controls[0]!.focus();
      for (let step = 0; step < 80 && reached.size < controls.length; step += 1) {
        const active = shadow.activeElement as HTMLElement | null;
        if (active && controls.includes(active)) {
          await nextFrame();
          const rect = active.getBoundingClientRect();
          const visible = shell.panel.getBoundingClientRect();
          expect(rect.top, active.textContent ?? '').toBeGreaterThanOrEqual(visible.top - 1);
          expect(rect.bottom, active.textContent ?? '').toBeLessThanOrEqual(visible.bottom + 1);
          const point = center(rect);
          expect(shadow.elementFromPoint(point.x, point.y)).toBe(active);
          reached.add(active);
        }
        await userEvent.tab();
      }
      expect(reached.size).toBe(controls.length);
    });
  }

  it('re-anchors the panel when its content grows and when the window resizes', async () => {
    await page.viewport(600, 400);
    const { shell } = mountOverlay();
    const stored: Annotation[] = [];
    const notePanel = notePanelFor(shell.panel, stored);
    cleanups.push(() => notePanel.teardown());
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    await notePanel.render(context());
    anchor.place(() => ({ x: 40, y: 60, width: 100, height: 30 }));
    await nextFrame();
    expectInsideViewport(shell.panel.getBoundingClientRect());

    stored.push(annotation('a1', 'First'), annotation('a2', 'Second'), annotation('a3', 'Third'));
    await notePanel.render(context());
    await vi.waitFor(() => expectInsideViewport(shell.panel.getBoundingClientRect()));
    expect(shell.panel.scrollHeight).toBeGreaterThan(shell.panel.clientHeight);

    await page.viewport(320, 300);
    await vi.waitFor(() => expectInsideViewport(shell.panel.getBoundingClientRect()));
  });
});

describe('long unbroken text wraps inside panels at 320 px (real browser)', () => {
  const LONG_WORD = 'x'.repeat(5000);
  const LONG_URL = `https://example.com/${'segment-'.repeat(300)}end`;

  it('wraps a 5,000-character word and a long URL in the note panel', async () => {
    await page.viewport(320, 568);
    const { shell } = mountOverlay();
    const notePanel = notePanelFor(shell.panel, [annotation('a1', LONG_WORD), annotation('a2', LONG_URL)]);
    cleanups.push(() => notePanel.teardown());
    await notePanel.render(context());
    await nextFrame();
    expect(shell.panel.scrollWidth).toBeLessThanOrEqual(shell.panel.clientWidth);
    expect(shell.panel.getBoundingClientRect().right).toBeLessThanOrEqual(viewportSize().width);
  });

  it('wraps a 5,000-character word and a long URL in the list panel', async () => {
    await page.viewport(320, 568);
    const { shell } = mountOverlay();
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [annotation('a1', LONG_WORD), annotation('a2', LONG_URL)],
      sendAnnotationWrite: vi.fn(async () => undefined),
      readBlob: vi.fn(),
      readOnboardingOpen: async () => false,
      readCaptureShortcut: async () => 'Alt+Q',
      writeOnboardingOpen: async () => undefined,
    });
    cleanups.push(() => list.clear());
    await list.render();
    await nextFrame();
    expect(shell.panel.scrollWidth).toBeLessThanOrEqual(shell.panel.clientWidth);
    expect(shell.panel.getBoundingClientRect().right).toBeLessThanOrEqual(viewportSize().width);
  });
});

describe('overlay layout with classic scrollbars (real browser)', () => {
  const TOLERANCE = 0.5;

  // Classic scrollbars take room that 100vw and innerWidth still count; the visible viewport is clientWidth.
  // Playwright hides scrollbars, so only the instance that provides classicScrollbars requires a real gap;
  // the other instances run these as non-regression checks.
  // The flag must match the instance name, so dropping or misplacing `provide` fails instead of skipping the gap check.
  async function classicScrollbars(projectName: string | undefined) {
    expect(inject('classicScrollbars') === true, `classicScrollbars on ${projectName}`)
      .toBe(projectName === 'browser (chromium classic scrollbars)');
    await page.viewport(360, 600);
    addPageStyle('html { overflow: scroll; } ::-webkit-scrollbar { width: 15px; height: 15px; }');
    await nextFrame();
    if (inject('classicScrollbars')) {
      expect(window.innerWidth - document.documentElement.clientWidth).toBeGreaterThanOrEqual(10);
      expect(window.innerHeight - document.documentElement.clientHeight).toBeGreaterThanOrEqual(10);
    }
    return viewportSize();
  }

  it('(b1) keeps the note panel 16 px inside both sides of the visible viewport', async ({ task }) => {
    const { width } = await classicScrollbars(task.file.projectName);
    const { shell } = mountOverlay();
    const notePanel = notePanelFor(shell.panel, [annotation('a1', 'First note')]);
    cleanups.push(() => notePanel.teardown());
    await notePanel.render(context());
    await nextFrame();
    const rect = shell.panel.getBoundingClientRect();
    expect(Math.abs(rect.width - Math.min(384, width - 32))).toBeLessThanOrEqual(TOLERANCE);
    expect(rect.left).toBeGreaterThanOrEqual(16 - TOLERANCE);
    expect(rect.right).toBeLessThanOrEqual(width - 16 + TOLERANCE);
  });

  it('(b2) keeps a wrapped toolbar inside the visible viewport', async ({ task }) => {
    const { width } = await classicScrollbars(task.file.projectName);
    const { shell } = mountOverlay();
    for (const label of ['Export', 'Settings', 'Help']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      shell.toolbar.append(button);
    }
    await nextFrame();
    const rect = shell.toolbar.getBoundingClientRect();
    expect(Math.abs(rect.width - (width - 32))).toBeLessThanOrEqual(TOLERANCE);
    expect(rect.left).toBeGreaterThanOrEqual(16 - TOLERANCE);
    expect(rect.right).toBeLessThanOrEqual(width + TOLERANCE);
  });

  it('(b3) keeps the wrapped capture hint 8 px inside both sides of the visible viewport', async ({ task }) => {
    const { width } = await classicScrollbars(task.file.projectName);
    const { host, shadow } = mountOverlay();
    const capture = createCaptureController({ document, shadowHost: host });
    cleanups.push(() => capture.destroy());
    capture.activate();
    const hint = shadow.querySelector<HTMLElement>('[data-annotation-capture-hint]')!;
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    const rect = hint.getBoundingClientRect();
    expect(Math.abs(rect.width - (width - 16))).toBeLessThanOrEqual(TOLERANCE);
    expect(rect.left).toBeGreaterThanOrEqual(8 - TOLERANCE);
    expect(rect.right).toBeLessThanOrEqual(width - 8 + TOLERANCE);
  });

  it('(b4) clamps a toolbar dragged past the bottom-right corner inside the visible viewport', async ({ task }) => {
    const { width, height } = await classicScrollbars(task.file.projectName);
    const { shell } = mountOverlay();
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: null, collapsed: false }), write: async () => undefined },
      onCollapsedChange: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const grip = shell.toolbar.querySelector<HTMLElement>('[data-annotation-toolbar-grip]')!;
    // Synthetic pointer events carry no active pointer for the browser to capture.
    grip.setPointerCapture = () => undefined;
    const start = center(grip.getBoundingClientRect());
    const send = (type: string, x: number, y: number) =>
      grip.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
    send('pointerdown', start.x, start.y);
    send('pointermove', start.x + 2000, start.y + 2000);
    send('pointerup', start.x + 2000, start.y + 2000);
    await nextFrame();
    const rect = shell.toolbar.getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(width - 8 + TOLERANCE);
    expect(rect.bottom).toBeLessThanOrEqual(height - 8 + TOLERANCE);
  });
});
