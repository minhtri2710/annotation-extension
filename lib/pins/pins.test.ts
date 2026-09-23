// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { buildSelector } from '../capture/selector';
import {
  createPinsController as createController,
  type PinsController,
  type PinsControllerOptions,
  pinCenter,
  placeTooltip,
  RERESOLVE_BACKOFF_CAP_MS,
  RERESOLVE_DEBOUNCE_MS,
  RERESOLVE_MAX_WAIT_MS,
  RESOLVE_SLICE_MS,
} from './pins';

const pageUrl = 'https://example.com/article';
const context: ElementContext = {
  selector: '#target',
  tagName: 'BUTTON',
  id: 'target',
  classList: [],
  text: 'Target',
  boundingBox: { x: 1, y: 2, width: 100, height: 40 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

function annotation(id: string, selector = context.selector): Annotation {
  return {
    id,
    pageUrl,
    note: `Note ${id}`,
    selector,
    elementContext: context,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
  };
}

function setup() {
  document.body.innerHTML = '<button id="target">Target</button><div id="toolbar"></div><div id="overlay"></div>';
  const toolbar = document.querySelector('#toolbar') as HTMLDivElement;
  const overlay = document.querySelector('#overlay') as HTMLDivElement;
  return { toolbar, overlay, target: document.querySelector('#target') as HTMLElement };
}

// The resolve slicer reads performance.now(); a still clock keeps every pass in one slice regardless of load.
let now = 0;

// Every controller a test creates is destroyed after it, even when the test fails.
const controllers: PinsController[] = [];

function createPinsController(options: PinsControllerOptions): PinsController {
  const controller = createController(options);
  controllers.push(controller);
  return controller;
}

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks();
});

describe('pins controller', () => {
  it('renders one marker for each annotation with a resolvable selector', () => {
    const { toolbar, overlay } = setup();
    const annotations = [annotation('annotation-1'), annotation('annotation-2', '#missing')];
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations(annotations);

    expect(overlay.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    expect(overlay.querySelector('[data-annotation-id="annotation-1"]')).not.toBeNull();
    expect(overlay.querySelector('[data-annotation-id="annotation-2"]')).toBeNull();
    controller.destroy();
  });

  it('sets the badge count to the page annotation count', () => {
    const { toolbar, overlay } = setup();
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([annotation('annotation-1'), annotation('annotation-2', '#missing')]);

    const badge = toolbar.querySelector('[data-annotation-badge]');
    expect(badge?.textContent).toBe('2 annotations');
    controller.destroy();
  });

  it('labels markers with their 1-based annotation ordinal', () => {
    const { toolbar, overlay } = setup();
    const secondTarget = document.createElement('button');
    secondTarget.id = 'second-target';
    document.body.append(secondTarget);
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([
      annotation('annotation-1'),
      annotation('annotation-2', '#missing'),
      annotation('annotation-3', '#second-target'),
    ]);

    const markers = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'));
    expect(markers.map((marker) => marker.textContent)).toEqual(['1', '3']);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'Annotation 1',
      'Annotation 3',
    ]);
    controller.destroy();
  });

  it('keeps marker badges at their source ordinals across an unresolved annotation', () => {
    const { toolbar, overlay } = setup();
    const thirdTarget = document.createElement('button');
    thirdTarget.id = 'third-target';
    document.body.append(thirdTarget);
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([
      annotation('annotation-1'),
      annotation('annotation-2', '#missing'),
      annotation('annotation-3', '#third-target'),
    ]);

    expect(Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'))
      .map((marker) => marker.textContent)).toEqual(['1', '3']);
    controller.destroy();
  });

  it('shows and tears down a truncated note tooltip on hover and focus', () => {
    const { toolbar, overlay } = setup();
    const matching = annotation('annotation-1');
    matching.note = 'P'.repeat(121);
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([matching]);
    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;

    marker.dispatchEvent(new Event('mouseenter'));
    const hoverTooltip = overlay.querySelector('[data-annotation-tooltip]');
    expect(hoverTooltip?.textContent).toBe(`${'P'.repeat(120)}…`);
    expect(hoverTooltip?.parentElement).toBe(overlay);

    marker.dispatchEvent(new Event('mouseleave'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();

    marker.dispatchEvent(new Event('focus'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
    marker.dispatchEvent(new Event('blur'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();

    marker.dispatchEvent(new Event('mouseenter'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
    controller.destroy();
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();
  });

  it('describes each pin by its own tooltip id, stable across re-renders', () => {
    const { toolbar, overlay } = setup();
    const second = document.createElement('button');
    second.id = 'second-target';
    document.body.append(second);
    const annotations = [annotation('annotation-1'), annotation('annotation-2', '#second-target')];
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations(annotations);
    const markerOf = (id: string) => overlay.querySelector(`[data-annotation-id="${id}"]`) as HTMLButtonElement;
    const first = markerOf('annotation-1').getAttribute('aria-describedby');
    const other = markerOf('annotation-2').getAttribute('aria-describedby');
    expect(first).toBeTruthy();
    expect(other).toBeTruthy();
    expect(first).not.toBe(other);

    markerOf('annotation-2').dispatchEvent(new Event('focus'));
    const tooltip = overlay.querySelector('[data-annotation-tooltip]');
    expect(tooltip?.id).toBe(other);
    expect(tooltip?.textContent).toBe('Note annotation-2');

    controller.setAnnotations(annotations);
    expect(markerOf('annotation-1').getAttribute('aria-describedby')).toBe(first);
    expect(markerOf('annotation-2').getAttribute('aria-describedby')).toBe(other);
    controller.destroy();
  });

  it('exposes the badge meaning as text instead of an aria-label on a plain span', () => {
    const { toolbar, overlay } = setup();
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([annotation('annotation-1'), annotation('annotation-2'), annotation('annotation-3')]);

    const badge = toolbar.querySelector('[data-annotation-badge]')!;
    expect(badge.hasAttribute('aria-label')).toBe(false);
    expect(badge.textContent).toBe('3 annotations');
    expect(badge.querySelector('[data-annotation-badge-unit]')?.textContent).toBe(' annotations');
    controller.destroy();
  });

  it('re-anchors tracked markers against their current element rect', () => {
    const { toolbar, overlay, target } = setup();
    const getBoundingClientRect = vi
      .spyOn(target, 'getBoundingClientRect')
      .mockReturnValue({
        x: 12,
        y: 34,
        left: 12,
        top: 34,
        right: 68,
        bottom: 112,
        width: 56,
        height: 78,
        toJSON: () => ({}),
      });
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([annotation('annotation-1')]);
    getBoundingClientRect.mockClear();

    controller.reanchor();

    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLElement;
    expect(getBoundingClientRect).toHaveBeenCalled();
    expect(marker.style.left).toBe('12px');
    expect(marker.style.top).toBe('34px');
    expect(marker.style.width).toBe('18px');
    expect(marker.style.height).toBe('18px');
    controller.destroy();
  });

  it('positions a pin for a shadow-deep annotation from the deep element rect', () => {
    const { toolbar, overlay } = setup();
    const host = document.createElement('x-card');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<span>a</span><span>b</span>';
    const deep = root.querySelectorAll('span')[1] as HTMLElement;
    vi.spyOn(deep, 'getBoundingClientRect').mockReturnValue({
      x: 21, y: 43, left: 21, top: 43, right: 71, bottom: 93, width: 50, height: 50, toJSON: () => ({}),
    });
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([annotation('annotation-1', buildSelector(deep))]);
    controller.reanchor();

    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(marker.style.left).toBe('21px');
    expect(marker.style.top).toBe('43px');
    controller.destroy();
  });

  it('marks resolved pins while keeping them clickable', () => {
    const { toolbar, overlay } = setup();
    const matching = { ...annotation('annotation-1'), status: 'resolved' as const };
    const onActivate = vi.fn();
    const controller = createPinsController({ document, container: overlay, toolbar, onActivate });
    controller.setAnnotations([matching]);
    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;
    expect(marker.dataset.annotationStatus).toBe('resolved');
    marker.click();
    expect(onActivate).toHaveBeenCalledWith(matching);
    controller.destroy();
  });

  it('activates the matching annotation exactly once when its marker is clicked', () => {
    const { toolbar, overlay } = setup();
    const matching = annotation('annotation-1');
    const onActivate = vi.fn();
    const controller = createPinsController({ document, container: overlay, toolbar, onActivate });
    controller.setAnnotations([matching]);

    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;
    marker.click();

    expect(marker.classList.contains('locate-pulse')).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(matching);
    controller.destroy();
  });

  describe('late-element re-resolve', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const markerTexts = (overlay: HTMLElement) =>
      Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'))
        .map((marker) => marker.textContent);

    it('pins an annotation whose element appears after setAnnotations with its list ordinal', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const onActivate = vi.fn();
      const late = annotation('annotation-2', '#late');
      const controller = createPinsController({ document, container: overlay, toolbar, onActivate });
      controller.setAnnotations([annotation('annotation-1'), late]);
      expect(markerTexts(overlay)).toEqual(['1']);

      const lateTarget = document.createElement('button');
      lateTarget.id = 'late';
      document.body.append(lateTarget);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(RERESOLVE_DEBOUNCE_MS - 1);
      expect(overlay.querySelector('[data-annotation-id="annotation-2"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      const marker = overlay.querySelector('[data-annotation-id="annotation-2"]') as HTMLButtonElement;
      expect(marker.textContent).toBe('2');
      expect(marker.getAttribute('aria-label')).toBe('Annotation 2');
      expect(toolbar.querySelector('[data-annotation-badge]')?.textContent).toBe('2 annotations');
      marker.click();
      expect(onActivate).toHaveBeenCalledWith(late);
      controller.destroy();
    });

    it('schedules no re-resolve timer while every annotation is resolved', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('annotation-1')]);

      document.body.append(document.createElement('p'));
      await Promise.resolve();

      expect(vi.getTimerCount()).toBe(0);
      controller.destroy();
    });

    it('clears the pending re-resolve timer on destroy', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('annotation-1', '#late')]);
      const lateTarget = document.createElement('button');
      lateTarget.id = 'late';
      document.body.append(lateTarget);
      await Promise.resolve();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      controller.destroy();

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(RERESOLVE_DEBOUNCE_MS);
      expect(overlay.querySelector('[data-annotation-id]')).toBeNull();
    });

    it('re-resolves within the max wait while mutations keep arriving faster than the debounce', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('annotation-1', '#late')]);
      const lateTarget = document.createElement('button');
      lateTarget.id = 'late';
      document.body.append(lateTarget);
      const ticker = document.createElement('span');
      document.body.append(ticker);

      for (let elapsed = 0; elapsed < RERESOLVE_MAX_WAIT_MS; elapsed += 100) {
        ticker.replaceChildren(String(elapsed));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(overlay.querySelector('[data-annotation-id="annotation-1"]')?.textContent).toBe('1');
      controller.destroy();
    });

    it('re-resolves a pin whose element a framework replaced', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay, target } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('annotation-1')]);

      const replacement = document.createElement('button');
      replacement.id = 'target';
      vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue({
        x: 40, y: 50, left: 40, top: 50, right: 60, bottom: 70, width: 20, height: 20, toJSON: () => ({}),
      });
      target.replaceWith(replacement);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(RERESOLVE_DEBOUNCE_MS);

      const markers = overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id="annotation-1"]');
      expect(markers).toHaveLength(1);
      const marker = markers[0] as HTMLButtonElement;
      expect(marker.hidden).toBe(false);
      expect(marker.textContent).toBe('1');
      expect(marker.style.left).toBe('40px');
      expect(marker.style.top).toBe('50px');
      controller.destroy();
      });

    it('doubles the forced re-resolve wait after each pass that pins nothing, up to the cap', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('annotation-1', '#missing')]);
      const querySelector = vi.spyOn(document, 'querySelector');
      const ticker = document.createElement('span');
      document.body.append(ticker);
      const passTimes: number[] = [];

      for (let elapsed = 100; elapsed <= 100_000; elapsed += 100) {
        ticker.replaceChildren(String(elapsed));
        await Promise.resolve();
        querySelector.mockClear();
        await vi.advanceTimersByTimeAsync(100);
        if (querySelector.mock.calls.some(([selector]) => selector === '#missing')) passTimes.push(elapsed + 100);
      }

      const gaps = passTimes.map((time, index) => time - (passTimes[index - 1] ?? 100));
      expect(gaps.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 16000, RERESOLVE_BACKOFF_CAP_MS]);
      expect(gaps.slice(6).every((gap) => gap === RERESOLVE_BACKOFF_CAP_MS)).toBe(true);
      querySelector.mockRestore();
      controller.destroy();
    });

    it('resets the backoff once a pass pins an annotation, and when setAnnotations runs', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      const controller = createPinsController({ document, container: overlay, toolbar });
      const annotations = [annotation('annotation-1', '#late'), annotation('annotation-2', '#missing')];
      controller.setAnnotations(annotations);
      const ticker = document.createElement('span');
      document.body.append(ticker);
      const mutate = async (ms: number) => {
        for (let elapsed = 0; elapsed < ms; elapsed += 100) {
          ticker.replaceChildren(String(elapsed));
          await Promise.resolve();
          await vi.advanceTimersByTimeAsync(100);
        }
      };
      await mutate(1000 + 2000 + 4000);
      const lateTarget = document.createElement('button');
      lateTarget.id = 'late';
      document.body.append(lateTarget);
      await mutate(8000);
      expect(overlay.querySelector('[data-annotation-id="annotation-1"]')?.textContent).toBe('1');

      const querySelector = vi.spyOn(document, 'querySelector');
      await mutate(RERESOLVE_MAX_WAIT_MS);
      expect(querySelector.mock.calls.some(([selector]) => selector === '#missing')).toBe(true);

      await mutate(2000 + 4000);
      controller.setAnnotations(annotations);
      querySelector.mockClear();
      await mutate(RERESOLVE_MAX_WAIT_MS);
      expect(querySelector.mock.calls.some(([selector]) => selector === '#missing')).toBe(true);
      querySelector.mockRestore();
      controller.destroy();
    });
  });

  describe('time-sliced resolve', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    // Every clock read advances one slice budget, so each pass yields after exactly one track().
    function slowClock() {
      vi.mocked(performance.now).mockImplementation(() => (now += RESOLVE_SLICE_MS));
    }

    function targets(count: number) {
      for (let index = 1; index <= count; index += 1) {
        const element = document.createElement('button');
        element.id = `t${index}`;
        document.body.append(element);
      }
    }

    const markerTexts = (overlay: HTMLElement) =>
      Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]')).map((marker) => marker.textContent);

    it('yields between slices and pins progressively in list order', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      targets(3);
      slowClock();
      const controller = createPinsController({ document, container: overlay, toolbar });

      controller.setAnnotations([
        annotation('a1', '#t1'),
        annotation('a2', '#missing'),
        annotation('a3', '#t2'),
        annotation('a4', '#t3'),
      ]);

      expect(markerTexts(overlay)).toEqual(['1']);
      expect(toolbar.querySelector('[data-annotation-badge]')?.textContent).toBe('4 annotations');
      await vi.advanceTimersByTimeAsync(0);
      expect(markerTexts(overlay)).toEqual(['1']);
      expect(vi.getTimerCount()).toBe(1);
      await vi.runAllTimersAsync();
      expect(markerTexts(overlay)).toEqual(['1', '3', '4']);
      expect(vi.getTimerCount()).toBe(0);
      controller.destroy();
    });

    it('cancels a running pass when a newer setAnnotations arrives', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      targets(3);
      slowClock();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('a1', '#t1'), annotation('a2', '#t2'), annotation('a3', '#t3')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(markerTexts(overlay)).toEqual(['1', '2']);
      expect(vi.getTimerCount()).toBe(1);

      controller.setAnnotations([annotation('b1', '#t3')]);
      await vi.advanceTimersByTimeAsync(10);

      expect(Array.from(overlay.querySelectorAll('[data-annotation-id]')).map((marker) => marker.getAttribute('data-annotation-id'))).toEqual(['b1']);
      controller.setAnnotations([annotation('a1', '#t1'), annotation('a2', '#t2'), annotation('a3', '#t3')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(markerTexts(overlay)).toEqual(['1', '2']);
      controller.setAnnotations([annotation('c1', '#t3'), annotation('c2', '#t1')]);
      await vi.runAllTimersAsync();
      const markers = Array.from(overlay.querySelectorAll('[data-annotation-id]'));
      expect(markers.map((marker) => marker.getAttribute('data-annotation-id'))).toEqual(['c1', 'c2']);
      expect(markerTexts(overlay)).toEqual(['1', '2']);
      expect(vi.getTimerCount()).toBe(0);
      controller.destroy();
    });

    it('cancels a running pass on destroy', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { toolbar, overlay } = setup();
      targets(3);
      slowClock();
      const controller = createPinsController({ document, container: overlay, toolbar });
      controller.setAnnotations([annotation('a1', '#t1'), annotation('a2', '#t2'), annotation('a3', '#t3')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(markerTexts(overlay)).toEqual(['1', '2']);
      expect(vi.getTimerCount()).toBe(1);

      controller.destroy();

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10);
      expect(overlay.querySelector('[data-annotation-id]')).toBeNull();
      await vi.runAllTimersAsync();
      expect(overlay.querySelector('[data-annotation-id]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('pin and tooltip placement', () => {
  const viewport = { width: 320, height: 480 };

  it('keeps the pin centred on the element corner away from the edges', () => {
    expect(pinCenter({ left: 40, top: 60, right: 140, bottom: 100 }, viewport)).toEqual({ x: 40, y: 60 });
  });

  it('pulls the pin fully inside the viewport while its element intersects it', () => {
    expect(pinCenter({ left: 0, top: 0, right: 100, bottom: 40 }, viewport)).toEqual({ x: 9, y: 9 });
    expect(pinCenter({ left: -50, top: -20, right: 50, bottom: 20 }, viewport)).toEqual({ x: 9, y: 9 });
    expect(pinCenter({ left: 316, top: 478, right: 400, bottom: 500 }, viewport)).toEqual({ x: 311, y: 471 });
  });

  it('leaves the pin of an element outside the viewport where the element is', () => {
    expect(pinCenter({ left: -500, top: 100, right: -400, bottom: 140 }, viewport)).toEqual({ x: -500, y: 100 });
    expect(pinCenter({ left: 40, top: 900, right: 140, bottom: 940 }, viewport)).toEqual({ x: 40, y: 900 });
  });

  it('places the tooltip right of the pin, flips it left at the right edge, and clamps it inside the viewport', () => {
    const size = { width: 200, height: 60 };
    expect(placeTooltip({ left: 20, top: 40, right: 38 }, size, viewport)).toEqual({ left: 46, top: 40 });
    expect(placeTooltip({ left: 280, top: 40, right: 298 }, size, viewport)).toEqual({ left: 72, top: 40 });
    expect(placeTooltip({ left: 150, top: 460, right: 168 }, size, viewport)).toEqual({ left: 8, top: 412 });
    expect(placeTooltip({ left: 20, top: -5, right: 38 }, { width: 400, height: 60 }, viewport)).toEqual({ left: 8, top: 8 });
  });
});

describe('pin tooltip dismissal', () => {
  it('hides the tooltip on Escape, keeps focus on the pin, and shows it again on the next hover', () => {
    const { toolbar, overlay } = setup();
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([annotation('annotation-1')]);
    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;

    marker.focus();
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();
    expect(document.activeElement).toBe(marker);

    marker.dispatchEvent(new Event('mouseenter'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
  });

  it('keeps the tooltip while the pointer moves from the pin onto it and hides it once the pointer leaves both', () => {
    const { toolbar, overlay } = setup();
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([annotation('annotation-1')]);
    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;

    marker.dispatchEvent(new MouseEvent('mouseenter'));
    const tooltip = overlay.querySelector('[data-annotation-tooltip]') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: tooltip }));
    tooltip.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: marker }));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBe(tooltip);

    tooltip.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();
  });
});
