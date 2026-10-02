import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createCaptureController } from '../capture/selection';
import { createAnnotationList } from '../annotation-list/annotation-list';
import { createNotePanel } from '../notes/note-panel';
import { createPinsController } from '../pins/pins';
import { createPanelMode } from '../wiring/panel-mode';
import { createLocateHighlight } from './locate-highlight';
import { setIconButton } from './icons';
import { buildOverlayShell, createPanelAnchor, raiseOverlay, setToolbarHidden } from './shell';
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
  const [annotate] = ['Annotate', 'Move toolbar', 'Scan', 'View all', 'Hide toolbar on this tab'].map((label) => {
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

      const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar, badgeHost: shell.toolbar.appendChild(document.createElement('button')) });
      cleanups.push(() => pins.destroy());
      pins.setAnnotations([annotation('a1', 'note')]);
      pins.reanchor();
      const pin = center(shell.root.querySelector('.annotation-pin')!.getBoundingClientRect());
      expect(Math.abs(pin.x - targetRect.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(pin.y - targetRect.top)).toBeLessThanOrEqual(1);

      const capture = createCaptureController({ document, shadowHost: host, shadowRoot: shadow });
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

// The overlay shell with nothing in the toolbar yet, for tests that add the production controls themselves.
function mountShell() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  reset.textContent = ':host{all:initial !important;}';
  const container = document.createElement('div');
  shadow.append(reset, container);
  const shell = buildOverlayShell(container);
  raiseOverlay(host);
  return { host, shadow, shell };
}

function addToolbarButtons(toolbar: HTMLElement, labels: string[]): HTMLButtonElement[] {
  return labels.map((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    toolbar.append(button);
    return button;
  });
}

const noPrefs = { read: async () => ({ position: null }), write: async () => undefined };

describe('toolbar layout (real browser)', () => {
  it('lays every control and the count out on one row at one height, with the count text unchanged', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    const [, viewAll] = addToolbarButtons(shell.toolbar, ['Scan', 'View all', 'Annotate']);
    viewAll!.dataset.annotationListToggle = '';
    const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar, badgeHost: viewAll! });
    cleanups.push(() => pins.destroy());
    pins.setAnnotations([annotation('a1', 'One'), annotation('a2', 'Two')]);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: noPrefs,
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    // The badge pops in with a scale animation; boxes are measured once it has finished.
    const settled = async () => {
      await nextFrame();
      await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    };
    await settled();

    const parts = () => [...shell.toolbar.children].filter((child) => getComputedStyle(child).display !== 'none') as HTMLElement[];
    const expectOneRowOneHeight = (expected: number) => {
      expect(parts()).toHaveLength(expected);
      const rects = parts().map((part) => part.getBoundingClientRect());
      for (const rect of rects) {
        expect(Math.abs(rect.height - rects[0]!.height)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(rect.top - rects[0]!.top)).toBeLessThanOrEqual(0.5);
      }
      const gaps = rects.slice(1).map((rect, index) => rect.left - rects[index]!.right);
      for (const gap of gaps) expect(Math.abs(gap - gaps[0]!)).toBeLessThanOrEqual(0.5);
    };
    const badge = shell.toolbar.querySelector<HTMLElement>('[data-annotation-badge]')!;
    expectOneRowOneHeight(5);
    expect(badge.textContent).toBe('2 annotations');
  });

  it('renders a word space between the count number and its unit for one and several annotations', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    const [viewAll] = addToolbarButtons(shell.toolbar, ['View all']);
    viewAll!.dataset.annotationListToggle = '';
    const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar, badgeHost: viewAll! });
    cleanups.push(() => pins.destroy());
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: noPrefs,
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;

    // A space that layout drops has no width, so the first character of the unit is measured as rendered.
    const renderedSpaceWidth = () => {
      const unit = shell.toolbar.querySelector('[data-annotation-badge-unit]')!;
      const range = document.createRange();
      range.setStart(unit.firstChild!, 0);
      range.setEnd(unit.firstChild!, 1);
      return range.getBoundingClientRect().width;
    };

    pins.setAnnotations([annotation('a1', 'One')]);
    expect(renderedSpaceWidth()).toBeGreaterThan(1);
    pins.setAnnotations([annotation('a1', 'One'), annotation('a2', 'Two'), annotation('a3', 'Three')]);
    expect(renderedSpaceWidth()).toBeGreaterThan(1);
    pins.setAnnotations([annotation('a1', 'One')]);
    expect(renderedSpaceWidth()).toBeGreaterThan(1);
  });

  it('overlaps the count badge on the top-right corner of the View all button, hides it at zero, keeps the button named View all and describes it by the badge', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    const [scan, viewAll] = addToolbarButtons(shell.toolbar, ['Scan', 'View all']);
    viewAll!.dataset.annotationListToggle = '';
    setIconButton(viewAll!, 'list', 'View all');
    const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar, badgeHost: viewAll! });
    cleanups.push(() => pins.destroy());
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: noPrefs,
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const settled = async () => {
      await nextFrame();
      await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    };
    const badge = () => viewAll!.querySelector<HTMLElement>('[data-annotation-badge]')!;

    pins.setAnnotations([]);
    await settled();
    expect(getComputedStyle(badge()).display).toBe('none');

    pins.setAnnotations([annotation('a1', 'One'), annotation('a2', 'Two')]);
    await settled();
    const expectCorner = () => {
      const button = viewAll!.getBoundingClientRect();
      const shown = badge().getBoundingClientRect();
      expect(shown.width).toBeGreaterThan(0);
      expect(getComputedStyle(badge()).position).toBe('absolute');
      expect(shown.left + shown.width / 2).toBeGreaterThan(button.left + button.width / 2);
      expect(shown.top + shown.height / 2).toBeLessThan(button.top + button.height / 2);
      expect(shown.left).toBeLessThan(button.right);
      expect(shown.bottom).toBeGreaterThan(button.top);
      expect(button.height).toBe(32);
      expect(button.width).toBe(32);
      const bar = getComputedStyle(shell.toolbar);
      const items = [...shell.toolbar.children].filter((child) => getComputedStyle(child).display !== 'none');
      const widths = items.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
      const chrome = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
        (sum, key) => sum + parseFloat(bar[key as 'paddingLeft']),
        0,
      );
      expect(shell.toolbar.getBoundingClientRect().width).toBeCloseTo(widths + parseFloat(bar.columnGap) * (items.length - 1) + chrome, 1);
    };
    expectCorner();
    expect(badge().textContent).toBe('2 annotations');
    expect(shell.toolbar.contains(badge())).toBe(true);
    expect(badge().parentElement).toBe(viewAll);
    expect(viewAll!.getAttribute('aria-describedby')).toBe(badge().id);
    expect(badge().id).not.toBe('');
    expect(scan!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps View all and its badge in one row with the other controls, where View all opens and closes All annotations', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    const [scan, viewAll] = addToolbarButtons(shell.toolbar, ['Scan', 'View all']);
    viewAll!.dataset.annotationListToggle = '';
    setIconButton(viewAll!, 'list', 'View all');
    const pins = createPinsController({ document, container: shell.root, toolbar: shell.toolbar, badgeHost: viewAll! });
    cleanups.push(() => pins.destroy());
    pins.setAnnotations([annotation('a1', 'One'), annotation('a2', 'Two'), annotation('a3', 'Three')]);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: noPrefs,
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [annotation('a1', 'One'), annotation('a2', 'Two'), annotation('a3', 'Three')],
      sendAnnotationWrite: vi.fn(async () => undefined),
      readBlob: vi.fn(),
      readOnboardingOpen: async () => false,
      readCaptureShortcut: async () => 'Alt+Q',
      writeOnboardingOpen: async () => undefined,
    });
    cleanups.push(() => list.clear());
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    const panels = createPanelMode({
      panel: shell.panel,
      overlayRoot: shell.root.getRootNode() as ShadowRoot,
      anchor,
      anchorToToolbar: () => shell.toolbar.getBoundingClientRect(),
      notePanel: { render: async () => undefined, clear: () => undefined },
      scanPanel: { render: async () => undefined, clear: () => undefined },
      annotationList: () => list,
      listToggle: viewAll!,
      scanToggle: scan!,
    });
    viewAll!.addEventListener('click', () => panels.toggle('list'));

    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const parts = [...shell.toolbar.children].filter((child) => getComputedStyle(child).display !== 'none') as HTMLElement[];
    expect(parts).toHaveLength(4);
    const tops = parts.map((part) => part.getBoundingClientRect().top);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
    const badge = viewAll!.querySelector<HTMLElement>('[data-annotation-badge]')!;
    expect(badge.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(viewAll!.getBoundingClientRect().width).toBeGreaterThan(0);

    await userEvent.click(viewAll!);
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-list-header]')).not.toBeNull());
    expect(viewAll!.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(viewAll!);
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-list-header]')).toBeNull());
    expect(viewAll!.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a bar that was hidden during a window shrink fully inside the viewport', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    addToolbarButtons(shell.toolbar, ['Scan', 'View all', 'Annotate']);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: { x: 700, y: 100 } }), write: async () => undefined },
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    expectInsideViewport(shell.toolbar.getBoundingClientRect());

    setToolbarHidden(shell.toolbar, true);
    await page.viewport(600, 400);
    await nextFrame();
    setToolbarHidden(shell.toolbar, false);
    await nextFrame();
    expectInsideViewport(shell.toolbar.getBoundingClientRect());
  });

  it('shows a bar stored near the right edge as one full-width row after a shrink while hidden, not a squeezed column', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    addToolbarButtons(shell.toolbar, ['Scan', 'View all', 'Annotate', 'Export', 'Import']);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: { x: 600, y: 100 } }), write: async () => undefined },
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const oneRow = shell.toolbar.getBoundingClientRect();
    const buttons = () => [...shell.toolbar.children].map((child) => child.getBoundingClientRect());
    expect(new Set(buttons().map((rect) => Math.round(rect.top))).size).toBe(1);

    setToolbarHidden(shell.toolbar, true);
    await page.viewport(800, 500);
    await nextFrame();
    setToolbarHidden(shell.toolbar, false);
    await nextFrame();

    const shown = shell.toolbar.getBoundingClientRect();
    expectInsideViewport(shown);
    expect(Math.abs(shown.height - oneRow.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(shown.width - oneRow.width)).toBeLessThanOrEqual(0.5);
    expect(new Set(buttons().map((rect) => Math.round(rect.top))).size).toBe(1);
  });

  it('leaves the stored position alone when the window resizes while the bar is hidden', async () => {
    await page.viewport(1280, 720);
    const { shell } = mountShell();
    addToolbarButtons(shell.toolbar, ['Scan', 'View all', 'Annotate']);
    const onPositionChange = vi.fn();
    const write = vi.fn(async () => undefined);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: { x: 600, y: 100 } }), write },
      onHide: () => undefined,
      onPositionChange,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const before = shell.toolbar.getBoundingClientRect();

    setToolbarHidden(shell.toolbar, true);
    await page.viewport(500, 300);
    await nextFrame();
    await page.viewport(1280, 720);
    await nextFrame();
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    setToolbarHidden(shell.toolbar, false);
    await nextFrame();
    const after = shell.toolbar.getBoundingClientRect();
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('leaves no focused control inside a bar that hides', async () => {
    const { shadow, shell } = mountShell();
    const [scan] = addToolbarButtons(shell.toolbar, ['Scan', 'View all']);
    scan!.focus();
    expect(shadow.activeElement).toBe(scan);

    setToolbarHidden(shell.toolbar, true);
    expect(shadow.activeElement === null || !shell.toolbar.contains(shadow.activeElement)).toBe(true);
    expect(shell.toolbar.contains(document.activeElement)).toBe(false);
  });
});

describe('pin stacking (real browser)', () => {
  it('paints an open panel and the toolbar over a pin whose position falls under them, and keeps the pin over the page elsewhere', async () => {
    await page.viewport(1280, 720);
    const targets = [['under-panel', 1000, 150], ['under-toolbar', 1100, 680], ['free', 100, 300]] as const;
    for (const [id, left, top] of targets) {
      const target = document.createElement('div');
      target.id = id;
      target.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: 60px; height: 30px; background: #ddd;`;
      document.body.append(target);
    }
    const { shadow, shell } = mountShell();
    addToolbarButtons(shell.toolbar, ['Scan', 'View all', 'Annotate']);
    const notePanel = notePanelFor(shell.panel, [annotation('a1', 'First note'), annotation('a2', 'Second note')]);
    cleanups.push(() => notePanel.teardown());
    await notePanel.render(context());
    // A toolbar with no box that the pins can be laid out against, so no pin is moved off the real toolbar.
    const noBox = document.createElement('div');
    document.body.append(noBox);
    const pins = createPinsController({ document, container: shell.root, toolbar: noBox, badgeHost: noBox.appendChild(document.createElement('button')) });
    cleanups.push(() => pins.destroy());
    pins.setAnnotations([annotation('p1', 'Under the panel', '#under-panel'), annotation('p2', 'Under the toolbar', '#under-toolbar'), annotation('p3', 'Free', '#free')]);
    pins.reanchor();
    await nextFrame();

    const [underPanel, underToolbar, free] = [...shell.root.querySelectorAll<HTMLElement>('.annotation-pin')].map((pin) => center(pin.getBoundingClientRect()));
    const inside = (rect: DOMRect, point: { x: number; y: number }) =>
      point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
    expect(inside(shell.panel.getBoundingClientRect(), underPanel!)).toBe(true);
    expect(inside(shell.toolbar.getBoundingClientRect(), underToolbar!)).toBe(true);
    expect(inside(shell.panel.getBoundingClientRect(), free!) || inside(shell.toolbar.getBoundingClientRect(), free!)).toBe(false);

    expect(shell.panel.contains(shadow.elementFromPoint(underPanel!.x, underPanel!.y))).toBe(true);
    expect(shell.toolbar.contains(shadow.elementFromPoint(underToolbar!.x, underToolbar!.y))).toBe(true);
    expect(shadow.elementFromPoint(free!.x, free!.y)?.classList.contains('annotation-pin')).toBe(true);
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
      shell.panel.querySelector<HTMLButtonElement>('[data-annotation-add-another]')!.click();
      await nextFrame();

      expectInsideViewport(shell.panel.getBoundingClientRect());
      expectInsideViewport(shell.toolbar.getBoundingClientRect());

      const controls = [
        shell.panel.querySelector<HTMLElement>('[data-annotation-close]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-new-note]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-save]')!,
        shell.panel.querySelector<HTMLElement>('[data-annotation-edit]')!,
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

describe('panel placement against the toolbar (real browser)', () => {
  // The panel enters with a short translate animation; boxes are measured once it has finished.
  async function settled(shell: { root: HTMLElement }): Promise<void> {
    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    await nextFrame();
  }

  // Fills the panel so its natural height is `natural` px, whatever its padding and border.
  function fillTo(panel: HTMLElement, natural: number): HTMLElement {
    const block = document.createElement('div');
    panel.append(block);
    block.style.height = '10px';
    const chrome = panel.offsetHeight - 10;
    block.style.height = `${natural - chrome}px`;
    return block;
  }

  it('re-places a panel that is clamped exactly at its max-height when its content then grows, so it goes above the box and nothing scrolls', async () => {
    const { shell } = mountOverlay();
    const bar = shell.toolbar.getBoundingClientRect();
    const box = { x: bar.left + 10, y: 450, width: 100, height: 20 };
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    const room = bar.top - 10 - (box.y + box.height + 8);
    fillTo(shell.panel, room);
    anchor.place(() => box);
    await settled(shell);

    const grown = document.createElement('div');
    grown.style.height = '100px';
    shell.panel.append(grown);
    await settled(shell);

    const rect = shell.panel.getBoundingClientRect();
    expect(shell.panel.scrollHeight).toBeLessThanOrEqual(shell.panel.clientHeight + 1);
    expect(rect.bottom).toBeLessThanOrEqual(box.y - 8 + 1);
    expect(rect.top).toBeGreaterThanOrEqual(10);
  });

  it('puts a panel above the box when it fits the viewport but not down to the toolbar, instead of clamping it', async () => {
    const { shell } = mountOverlay();
    const bar = shell.toolbar.getBoundingClientRect();
    const box = { x: bar.left + 10, y: 450, width: 100, height: 20 };
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    const room = bar.top - 10 - (box.y + box.height + 8);
    fillTo(shell.panel, room + 20);
    anchor.place(() => box);
    await settled(shell);

    const rect = shell.panel.getBoundingClientRect();
    expect(shell.panel.scrollHeight).toBeLessThanOrEqual(shell.panel.clientHeight + 1);
    expect(rect.bottom).toBeLessThanOrEqual(box.y - 8 + 1);
  });

  it('keeps a scrolled panel where it was scrolled when its content changes', async () => {
    const { shell } = mountOverlay();
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    fillTo(shell.panel, 3000);
    anchor.place(() => ({ x: 40, y: 60, width: 100, height: 30 }));
    await settled(shell);
    // The anchor's cap is below the stylesheet's, so measuring uncapped would clamp a scroll at the bottom.
    shell.panel.scrollTop = shell.panel.scrollHeight;
    const scrolled = shell.panel.scrollTop;
    expect(scrolled).toBeGreaterThan(200);

    const added = document.createElement('div');
    added.style.height = '20px';
    shell.panel.append(added);
    await settled(shell);

    expect(shell.panel.scrollTop).toBe(scrolled);
  });

  it('keeps the note and list headers in view while the panel body scrolls', async () => {
    await page.viewport(600, 400);
    const { shadow, shell } = mountOverlay();
    const anchor = createPanelAnchor(shell.panel, shell.toolbar);
    cleanups.push(() => anchor.destroy());
    const stored = Array.from({ length: 12 }, (_, index) => annotation(`a${index}`, `Note ${index}`));
    const notePanel = notePanelFor(shell.panel, stored);
    cleanups.push(() => notePanel.teardown());
    await notePanel.render(context());
    anchor.place(() => ({ x: 40, y: 60, width: 100, height: 30 }));
    await nextFrame();
    const expectHeaderPinned = (selector: string) => {
      shell.panel.scrollTop = shell.panel.scrollHeight;
      expect(shell.panel.scrollTop).toBeGreaterThan(0);
      const headerElement = shell.panel.querySelector<HTMLElement>(selector)!;
      const header = headerElement.getBoundingClientRect();
      const { top, bottom } = shell.panel.getBoundingClientRect();
      expect(header.top).toBeGreaterThanOrEqual(top);
      expect(header.top).toBeLessThanOrEqual(top + 2);
      const close = headerElement.querySelector<HTMLElement>('[data-annotation-close]')!;
      const rect = close.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(top);
      expect(rect.bottom).toBeLessThanOrEqual(bottom);
      expect(shadow.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(close);
    };
    expectHeaderPinned('[data-annotation-note-header]');

    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => stored,
      sendAnnotationWrite: vi.fn(async () => undefined),
      readBlob: vi.fn(),
      readOnboardingOpen: async () => true,
      readCaptureShortcut: async () => 'Alt+Q',
      writeOnboardingOpen: async () => undefined,
    });
    cleanups.push(() => list.clear());
    await list.render();
    await nextFrame();
    expectHeaderPinned('[data-annotation-list-header]');
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
    const capture = createCaptureController({ document, shadowHost: host, shadowRoot: shadow });
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
      prefs: { read: async () => ({ position: null }), write: async () => undefined },
      onHide: () => undefined,
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
