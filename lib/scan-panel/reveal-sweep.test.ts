// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealSweep } from './reveal-sweep';

const originalScrollTo = window.scrollTo;
let position: { x: number; y: number };
let scrollTo: ReturnType<typeof vi.fn<(options: ScrollToOptions) => void>>;

function stubPage(scrollHeight: number, innerHeight: number): void {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(0);
}

function tops(): number[] {
  return scrollTo.mock.calls.map(([options]) => options.top ?? Number.NaN);
}

async function advanceUntil(done: () => boolean): Promise<void> {
  for (let ms = 0; ms < 10_000 && !done(); ms += 1) await vi.advanceTimersByTimeAsync(1);
  expect(done()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  position = { x: 30, y: 1234 };
  vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => position.x);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => position.y);
  scrollTo = vi.fn((options: ScrollToOptions) => {
    position = { x: options.left ?? position.x, y: options.top ?? position.y };
  });
  window.scrollTo = scrollTo as typeof window.scrollTo;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.scrollTo = originalScrollTo;
});

describe('revealSweep', () => {
  it('steps by 70% of the viewport through the bottom, instant only, then restores and settles 700ms', async () => {
    stubPage(2000, 1000);
    let settled = false;
    const done = revealSweep(window, new AbortController().signal).then(() => {
      settled = true;
    });
    expect(tops()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(39);
    expect(tops()).toEqual([0]);
    await advanceUntil(() => tops().length === 4);
    expect(tops()).toEqual([0, 700, 1400, 1234]);
    expect(position).toEqual({ x: 30, y: 1234 });
    await vi.advanceTimersByTimeAsync(699);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    for (const [options] of scrollTo.mock.calls) expect(options.behavior).toBe('instant');
    expect(scrollTo.mock.calls.slice(0, -1).map(([options]) => options.left)).toEqual([0, 0, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports the swept fraction after each settled step, ending at 1 before the restore', async () => {
    stubPage(2000, 1000);
    const progress: number[] = [];
    const topsAtProgress: number[][] = [];
    const done = revealSweep(window, new AbortController().signal, (fraction) => {
      progress.push(fraction);
      topsAtProgress.push(tops());
    });
    await vi.runAllTimersAsync();
    await done;
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
    expect(topsAtProgress).toEqual([[0], [0, 700], [0, 700, 1400]]);
  });

  it('never steps less than 200px on a short viewport', async () => {
    stubPage(500, 100);
    const done = revealSweep(window, new AbortController().signal);
    await vi.runAllTimersAsync();
    await done;
    expect(tops()).toEqual([0, 200, 400, 1234]);
  });

  it('sweeps a very tall page all the way to its bottom', async () => {
    stubPage(1_000_000, 1000);
    const done = revealSweep(window, new AbortController().signal);
    await vi.runAllTimersAsync();
    await done;
    expect(tops()).toHaveLength(1430);
    expect(tops().at(-2)).toBe(1428 * 700);
    expect(position).toEqual({ x: 30, y: 1234 });
  });

  it('bounds the sweep by the scroll height measured at the start when the page grows', async () => {
    stubPage(2000, 1000);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => 2000 + scrollTo.mock.calls.length * 5000);
    const done = revealSweep(window, new AbortController().signal);
    await vi.runAllTimersAsync();
    await done;
    expect(tops()).toEqual([0, 700, 1400, 1234]);
  });

  it('rejects with the reason on abort mid-settle, restores the position, and leaves no timer pending', async () => {
    stubPage(5000, 1000);
    const controller = new AbortController();
    const done = revealSweep(window, controller.signal);
    const outcome = done.catch((error: unknown) => error);
    await advanceUntil(() => tops().length === 2);
    await vi.advanceTimersByTimeAsync(20);
    const reason = new Error('stop');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(tops()).toEqual([0, 700, 1234]);
    expect(position).toEqual({ x: 30, y: 1234 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects before any scroll when already aborted', async () => {
    stubPage(5000, 1000);
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(revealSweep(window, controller.signal)).rejects.toThrow('early');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects on abort during the final settle with the position already restored', async () => {
    stubPage(100, 1000);
    const controller = new AbortController();
    const outcome = revealSweep(window, controller.signal).catch((error: unknown) => error);
    await advanceUntil(() => tops().length === 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(position).toEqual({ x: 30, y: 1234 });
    controller.abort(new Error('late'));
    expect(await outcome).toEqual(new Error('late'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores the exact position when a scroll step throws', async () => {
    stubPage(5000, 1000);
    const step = scrollTo.getMockImplementation()!;
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      if (options.top === 1400) throw new Error('scroll broke');
      step(options);
    });
    const outcome = revealSweep(window, new AbortController().signal).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual(new Error('scroll broke'));
    expect(tops()).toEqual([0, 700, 1400, 1234]);
    expect(position).toEqual({ x: 30, y: 1234 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
