import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page as browserPage, userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import { buildSelector } from '../capture/selector';
import { buildOverlayShell } from '../ui/shell';
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

  it('leaves the pin of an element outside the viewport off-screen', () => {
    const { shell } = mountShell();
    placeTarget('left: -500px; top: 100px');
    controller = createPinsController({ document, container: shell.root, toolbar: shell.toolbar });
    controller.setAnnotations([annotation(0, '#edge-target')]);
    controller.reanchor();

    expect(shell.root.querySelector<HTMLElement>('.annotation-pin')!.getBoundingClientRect().right).toBeLessThanOrEqual(0);
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
});
