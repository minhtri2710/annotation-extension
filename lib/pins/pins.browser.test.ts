import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page as browserPage, userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import { buildSelector } from '../capture/selector';
import { buildOverlayShell, type OverlayShell } from '../ui/shell';
import { createToolbarControls, type ToolbarControls } from '../ui/toolbar-controls';
import type { ToolbarPrefs } from '../ui/ui-prefs';
import { createPinsController, type PinsController } from './pins';

const PAGE_ELEMENTS = 50_000;
const ANNOTATIONS = 200;

let toolbar: HTMLDivElement;
let overlay: HTMLDivElement;
let controller: PinsController | undefined;

function annotation(index: number, selector: string): Annotation {
  const context = {
    selector,
    tagName: 'SPAN',
    id: '',
    classList: [],
    text: '',
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    url: location.href,
    viewport: { width: 0, height: 0 },
    sourcePath: null,
  };
  return {
    id: `a${index}`,
    pageUrl: location.href,
    note: `note ${index}`,
    selector,
    elementContext: context,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
  };
}

// 500 sections x 50 divs x (div + span) = 50,000 elements plus the sections.
function buildPage(): HTMLElement {
  const page = document.createElement('main');
  const row = '<div><span>x</span></div>'.repeat(50);
  page.insertAdjacentHTML('beforeend', `<section>${row}</section>`.repeat(PAGE_ELEMENTS / 100));
  document.body.append(page);
  return page;
}

// Times the controller's resolve slices: it yields with setTimeout(slice, 0), so only zero-delay
// callbacks are timed. Test tooling (vi.waitFor polling) and the re-resolve timers use real delays
// and pass through untimed, as does the page-wide heartbeat below.
function timeTimerCallbacks(): number[] {
  const durations: number[] = [];
  const original = window.setTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (timeout || typeof handler !== 'function') return original(handler, timeout, ...args);
    return original(() => {
      const start = performance.now();
      handler();
      durations.push(performance.now() - start);
    }, timeout);
  }) as typeof window.setTimeout);
  return durations;
}

// Information only: the longest gap between 4 ms heartbeat ticks also counts other tests' tasks,
// GC and machine load, so it is printed but never asserted on.
function startHeartbeat(): () => number {
  const original = window.setTimeout.bind(window);
  let last = performance.now();
  let longest = 0;
  let running = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) original(tick, 4);
  };
  original(tick, 4);
  return () => {
    running = false;
    return Math.max(longest, performance.now() - last);
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  toolbar = document.createElement('div');
  overlay = document.createElement('div');
  // Production mounts pins in the extension's fixed overlay layer, out of the page's flow.
  overlay.style.cssText = 'position: fixed; inset: 0; pointer-events: none';
  document.body.append(toolbar, overlay);
});

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('pin resolve cost on a 50k-element page (real browser)', () => {
  // Preemption only adds wall time, so the spec passes on the first of up to 3 fresh runs that
  // yields more than once with its longest slice within budget; a real over-budget stretch fails all 3.
  it('pins 200 annotations in list order with no resolve slice over 50 ms in the best of 3 runs', async () => {
    const runs: Array<{ slices: number; longest: number }> = [];
    for (let run = 0; run < 3; run += 1) {
      controller?.destroy();
      overlay.replaceChildren();
      document.querySelector('main')?.remove();
      const page = buildPage();
      const spans = page.querySelectorAll('span');
      const step = Math.floor(spans.length / ANNOTATIONS);
      const annotations = Array.from({ length: ANNOTATIONS }, (_, index) =>
        annotation(index, buildSelector(spans[index * step]!)),
      );
      controller = createPinsController({ document, container: overlay, toolbar });
      // Settle the fresh page's first style and layout outside the measured window.
      page.getBoundingClientRect();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const stopHeartbeat = startHeartbeat();
      const slices = timeTimerCallbacks();

      const start = performance.now();
      controller.setAnnotations(annotations);
      const syncMs = performance.now() - start;
      await vi.waitFor(() => expect(overlay.querySelectorAll('[data-annotation-id]')).toHaveLength(ANNOTATIONS), {
        timeout: 10_000,
      });
      const heartbeatGap = stopHeartbeat();
      vi.mocked(window.setTimeout).mockRestore();
      const longest = Math.max(syncMs, ...slices);
      runs.push({ slices: slices.length, longest });

      console.info(
        `[pins P3] run ${run + 1}: sync setAnnotations ${syncMs.toFixed(1)} ms, ${slices.length} slices, longest slice ${longest.toFixed(1)} ms, heartbeat gap ${heartbeatGap.toFixed(1)} ms (info)`,
      );
      const markers = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'));
      expect(markers.map((marker) => marker.textContent)).toEqual(annotations.map((_, index) => String(index + 1)));
      if (slices.length > 1 && longest < 50) break;
    }
    const summary = runs.map((r) => `${r.slices} slices, longest ${r.longest.toFixed(1)} ms`).join('; ');
    expect(runs.some((r) => r.slices > 1 && r.longest < 50), `per run: ${summary}`).toBe(true);
  }, 90_000);

  it('backs off re-resolving 200 unresolved annotations while the page keeps mutating', async () => {
    buildPage();
    const annotations = Array.from({ length: ANNOTATIONS }, (_, index) => annotation(index, `#missing-${index}`));
    controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations(annotations);
    const querySelector = vi.spyOn(document, 'querySelector');
    const ticker = document.createElement('span');
    document.body.append(ticker);
    let tick = 0;
    const interval = setInterval(() => {
      ticker.textContent = String((tick += 1));
    }, 100);

    await new Promise((resolve) => setTimeout(resolve, 10_000));
    clearInterval(interval);

    // One pass resolves #missing-0 once; without backoff the 1 s max wait forces about 10 passes in 10 s.
    const passes = querySelector.mock.calls.filter(([selector]) => selector === '#missing-0').length;
    console.info(`[pins P2] re-resolve passes in 10 s: ${passes}`);
    expect(passes).toBeGreaterThanOrEqual(2);
    expect(passes).toBeLessThanOrEqual(4);
  }, 30_000);
});

describe('pins and their tooltip at the viewport edges (real browser)', () => {
  function mountShell() {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    return { shadow, shell: buildOverlayShell(container) };
  }

  function placeTarget(css: string): HTMLElement {
    const target = document.createElement('div');
    target.id = 'edge-target';
    target.style.cssText = `position: fixed; width: 100px; height: 40px; ${css}`;
    document.body.append(target);
    return target;
  }

  function viewport() {
    return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  }

  function expectInside(rect: DOMRect): void {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewport().width);
    expect(rect.bottom).toBeLessThanOrEqual(viewport().height);
  }

  afterEach(async () => {
    await browserPage.viewport(1280, 720);
  });

  for (const [name, css] of [
    ['flush with the top-left corner', 'left: 0; top: 0'],
    ['partly outside the left and top edges', 'left: -50px; top: -20px'],
  ] as const) {
    it(`shows the pin of an element ${name} fully inside the viewport, on the element's corner region`, () => {
      const { shell } = mountShell();
      const target = placeTarget(css);
      controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
      controller.setAnnotations([annotation(0, '#edge-target')]);
      controller.reanchor();

      const marker = shell.root.querySelector<HTMLElement>('.annotation-pin')!;
      const pin = marker.getBoundingClientRect();
      expectInside(pin);
      const element = target.getBoundingClientRect();
      const centerX = pin.left + pin.width / 2;
      const centerY = pin.top + pin.height / 2;
      expect(centerX).toBeGreaterThanOrEqual(element.left);
      expect(centerY).toBeGreaterThanOrEqual(element.top);
      expect(centerX - Math.max(element.left, 0)).toBeLessThanOrEqual(pin.width);
      expect(centerY - Math.max(element.top, 0)).toBeLessThanOrEqual(pin.height);
    });
  }

  for (const [name, css] of [
    ['away from the edges', 'left: 200px; top: 200px'],
    ['at the right edge', 'right: 0; top: 200px; width: 20px'],
  ] as const) {
    it(`fans three pins on one element ${name} apart, none overlapping and each inside the viewport`, () => {
      const { shell } = mountShell();
      placeTarget(css);
      controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
      controller.setAnnotations([0, 1, 2].map((index) => annotation(index, '#edge-target')));
      controller.reanchor();

      const pins = Array.from(shell.root.querySelectorAll<HTMLElement>('.annotation-pin'), (marker) => marker.getBoundingClientRect());
      expect(pins).toHaveLength(3);
      for (const pin of pins) expectInside(pin);
      for (const [i, a] of pins.entries()) {
        for (const b of pins.slice(i + 1)) {
          const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlaps, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(false);
        }
      }
    });
  }

  it('keeps the pins of two elements whose corners are 10 px apart from overlapping, each clickable at its centre', () => {
    const { shadow, shell } = mountShell();
    placeTarget('left: 200px; top: 200px');
    const neighbour = document.createElement('div');
    neighbour.id = 'neighbour-target';
    neighbour.style.cssText = 'position: absolute; left: 210px; top: 200px; width: 100px; height: 40px';
    document.body.append(neighbour);
    document.getElementById('edge-target')!.style.position = 'absolute';
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target'), annotation(1, '#neighbour-target')]);
    controller.reanchor();

    const markers = Array.from(shell.root.querySelectorAll<HTMLElement>('.annotation-pin'));
    expect(markers).toHaveLength(2);
    const [a, b] = markers.map((marker) => marker.getBoundingClientRect()) as [DOMRect, DOMRect];
    const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    expect(overlaps, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(false);
    for (const marker of markers) {
      const rect = marker.getBoundingClientRect();
      expect(shadow.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(marker);
    }
  });

  it('hides the pin of an element outside the viewport', () => {
    const { shell } = mountShell();
    placeTarget('left: -500px; top: 100px');
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target')]);
    controller.reanchor();

    const marker = shell.root.querySelector<HTMLButtonElement>('.annotation-pin')!;
    expect(marker.hidden).toBe(true);
    expect(marker.checkVisibility()).toBe(false);
    expect(marker.getBoundingClientRect().width).toBe(0);
  });

  it('hides the pin of a display: none element and shows it once the element is displayed', () => {
    const { shadow, shell } = mountShell();
    const target = placeTarget('left: 200px; top: 200px; display: none');
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target')]);
    controller.reanchor();

    const marker = shell.root.querySelector<HTMLButtonElement>('.annotation-pin')!;
    expect(marker.hidden).toBe(true);
    expect(getComputedStyle(marker).display).toBe('none');
    expect(marker.checkVisibility()).toBe(false);
    expect(marker.getBoundingClientRect().width).toBe(0);
    const before = document.activeElement;
    marker.focus();
    expect(document.activeElement).toBe(before);
    expect(shadow.activeElement).toBeNull();
    expect(browserPage.getByRole('button', { name: 'Annotation 1' }).query()).toBeNull();

    target.style.display = 'block';
    controller.reanchor();
    expect(marker.hidden).toBe(false);
    expect(marker.checkVisibility()).toBe(true);
    expect(browserPage.getByRole('button', { name: 'Annotation 1' }).query()).toBe(marker);
    const pin = marker.getBoundingClientRect();
    expect(pin.left + pin.width / 2).toBeCloseTo(200);
    expect(pin.top + pin.height / 2).toBeCloseTo(200);
  });

  it('dismisses the tooltip with Escape without moving focus or hover', async () => {
    const { shadow, shell } = mountShell();
    placeTarget('left: 200px; top: 200px');
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target')]);
    controller.reanchor();
    const marker = shell.root.querySelector<HTMLElement>('.annotation-pin')!;

    marker.focus();
    expect(shell.root.querySelector('[role="tooltip"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(shell.root.querySelector('[role="tooltip"]')).toBeNull();
    expect(shadow.activeElement).toBe(marker);

    marker.blur();
    await userEvent.hover(marker);
    expect(shell.root.querySelector('[role="tooltip"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(shell.root.querySelector('[role="tooltip"]')).toBeNull();
    expect(marker.matches(':hover')).toBe(true);
  });

  it('keeps the tooltip while the pointer moves onto it', async () => {
    const { shell } = mountShell();
    placeTarget('left: 200px; top: 200px');
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target')]);
    controller.reanchor();
    const marker = shell.root.querySelector<HTMLElement>('.annotation-pin')!;

    await userEvent.hover(marker);
    const tooltip = shell.root.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip).not.toBeNull();
    await userEvent.hover(tooltip);
    expect(shell.root.querySelector('[role="tooltip"]')).toBe(tooltip);
    expect(tooltip.matches(':hover')).toBe(true);

    const away = document.createElement('div');
    away.style.cssText = 'position: fixed; left: 900px; top: 500px; width: 40px; height: 40px';
    document.body.append(away);
    await userEvent.hover(away);
    expect(shell.root.querySelector('[role="tooltip"]')).toBeNull();
  });

  for (const width of [320, 600]) {
    it(`clamps the tooltip inside a ${width} px viewport at the right and bottom edges`, async () => {
      await browserPage.viewport(width, 480);
      const { shell } = mountShell();
      placeTarget('right: 4px; bottom: 4px; width: 20px; height: 20px');
      controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
      const long = annotation(0, '#edge-target');
      long.note = 'A long note that fills the tooltip preview. '.repeat(6);
      controller.setAnnotations([long]);
      controller.reanchor();
      const marker = shell.root.querySelector<HTMLElement>('.annotation-pin')!;

      marker.focus();
      expectInside(shell.root.querySelector<HTMLElement>('[role="tooltip"]')!.getBoundingClientRect());
    });
  }

  describe('when the toolbar moves or changes size', () => {
    let controls: ToolbarControls | undefined;

    // A run of these specs alone starts at the runner's default viewport, not the 1280 x 720 the edge tests restore.
    beforeEach(async () => {
      await browserPage.viewport(1280, 720);
    });

    afterEach(() => {
      controls?.destroy();
      controls = undefined;
    });

    // Mounted as in production: the pins controller first, then the toolbar buttons and controls.
    function mountToolbar(stored: ToolbarPrefs = { position: null, collapsed: false }) {
      const { shell } = mountShell();
      controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
      for (const label of ['Scan page', 'List annotations', 'Annotate']) {
        const button = document.createElement('button');
        button.textContent = label;
        shell.toolbar.append(button);
      }
      controls = createToolbarControls({
        toolbar: shell.toolbar,
        win: window,
        // Storage answers after the page has rendered, as chrome.storage may.
        prefs: { read: () => frames().then(() => stored), write: async () => undefined },
        onCollapsedChange: () => undefined,
        onPositionChange: () => undefined,
      });
      return shell;
    }

    function annotate(shell: OverlayShell): HTMLElement {
      controller!.setAnnotations([annotation(0, '#edge-target')]);
      return shell.root.querySelector<HTMLElement>('.annotation-pin')!;
    }

    // The badge count is part of the toolbar's width, so the target is placed relative to the toolbar
    // measured after its annotation is set.
    function annotateBeside(shell: OverlayShell, place: (bar: DOMRect) => { x: number; y: number }) {
      const target = placeTarget('left: 0; top: 0');
      const marker = annotate(shell);
      const bar = shell.toolbar.getBoundingClientRect();
      const own = place(bar);
      target.style.left = `${own.x}px`;
      target.style.top = `${own.y}px`;
      controller!.reanchor();
      return { marker, bar, own };
    }

    function overlaps(a: DOMRect, b: DOMRect): boolean {
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }

    function center(rect: DOMRect): { x: number; y: number } {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    it('moves a pin off the toolbar after an arrow key on the grip moves the toolbar over it', async () => {
      const shell = mountToolbar();
      await controls!.ready;
      // The pin's own centre lies 30 px left of the toolbar, clear of it until the toolbar moves 64 px left.
      const { marker, bar, own } = annotateBeside(shell, (bar) => ({ x: bar.left - 30, y: bar.top + bar.height / 2 }));
      await frames();
      expect(center(marker.getBoundingClientRect()).x).toBeCloseTo(own.x, 0);
      expect(center(marker.getBoundingClientRect()).y).toBeCloseTo(own.y, 0);

      shell.root.querySelector<HTMLElement>('[data-annotation-toolbar-grip]')!.focus();
      await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
      const moved = shell.toolbar.getBoundingClientRect();
      expect(moved.left).toBeCloseTo(bar.left - 64);
      expect(own.x).toBeGreaterThan(moved.left);
      await frames();

      const pin = marker.getBoundingClientRect();
      expect(overlaps(pin, moved), `${JSON.stringify(pin)} overlaps ${JSON.stringify(moved)}`).toBe(false);
    });

    it('moves a pin off the toolbar after the toolbar is collapsed and expanded over it', async () => {
      const shell = mountToolbar();
      await controls!.ready;
      const { marker, bar: expanded, own } = annotateBeside(shell, (bar) => ({ x: bar.left + 20, y: bar.top + bar.height / 2 }));
      await frames();
      expect(overlaps(marker.getBoundingClientRect(), expanded)).toBe(false);

      const collapse = shell.root.querySelector<HTMLElement>('[data-annotation-toolbar-collapse]')!;
      await userEvent.click(collapse);
      await frames();
      // The collapsed toolbar leaves the pin's own centre free, so the pin returns to it.
      expect(overlaps(marker.getBoundingClientRect(), shell.toolbar.getBoundingClientRect())).toBe(false);
      expect(center(marker.getBoundingClientRect()).x).toBeCloseTo(own.x, 0);
      expect(center(marker.getBoundingClientRect()).y).toBeCloseTo(own.y, 0);

      await userEvent.click(collapse);
      await frames();
      const bar = shell.toolbar.getBoundingClientRect();
      expect(bar.width).toBeCloseTo(expanded.width);
      const pin = marker.getBoundingClientRect();
      expect(overlaps(pin, bar), `${JSON.stringify(pin)} overlaps ${JSON.stringify(bar)}`).toBe(false);
    });

    it('moves a pin off the toolbar once a stored position that covers it is applied', async () => {
      const shell = mountToolbar({ position: { x: 100, y: 100 }, collapsed: false });
      placeTarget('left: 110px; top: 110px');
      const marker = annotate(shell);
      expect(center(marker.getBoundingClientRect())).toEqual({ x: 110, y: 110 });

      await controls!.ready;
      const bar = shell.toolbar.getBoundingClientRect();
      expect([bar.left, bar.top]).toEqual([100, 100]);
      await frames();

      const pin = marker.getBoundingClientRect();
      expect(overlaps(pin, bar), `${JSON.stringify(pin)} overlaps ${JSON.stringify(bar)}`).toBe(false);
    });
  });
});
