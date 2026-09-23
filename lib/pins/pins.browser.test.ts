import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import { buildSelector } from '../capture/selector';
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

// Times every setTimeout callback, which is how the controller yields between slices. Other test
// files share this main thread, so a page-wide heartbeat would also count their tasks.
function timeTimerCallbacks(): number[] {
  const durations: number[] = [];
  const original = window.setTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number) =>
    original(() => {
      const start = performance.now();
      if (typeof handler === 'function') handler();
      durations.push(performance.now() - start);
    }, timeout)) as typeof window.setTimeout);
  return durations;
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
  it('pins 200 annotations in list order with no main-thread stretch over 50 ms', async () => {
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
    const slices = timeTimerCallbacks();

    const start = performance.now();
    controller.setAnnotations(annotations);
    const syncMs = performance.now() - start;
    await vi.waitFor(() => expect(overlay.querySelectorAll('[data-annotation-id]')).toHaveLength(ANNOTATIONS), {
      timeout: 10_000,
    });
    const longest = Math.max(syncMs, ...slices);

    console.info(`[pins P3] sync setAnnotations ${syncMs.toFixed(1)} ms, longest stretch ${longest.toFixed(1)} ms`);
    expect(slices.length).toBeGreaterThan(1);
    expect(longest).toBeLessThan(50);
    const markers = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'));
    expect(markers.map((marker) => marker.textContent)).toEqual(annotations.map((_, index) => String(index + 1)));
  }, 30_000);

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
