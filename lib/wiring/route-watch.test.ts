// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchRoute } from './route-watch';

const origin = window.location.origin;
const flushMutations = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  if (!document.head) document.documentElement.prepend(document.createElement('head'));
  window.history.replaceState(null, '', '/start');
  document.head.innerHTML = '<title>Start</title>';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watchRoute', () => {
  it('reports a new URL when popstate follows a path change', () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/next');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(`${origin}/next`);
    stop();
  });

  it('reports a pushState navigation signalled only by a title change', async () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/spa-route');
    document.title = 'SPA route';
    await flushMutations();

    expect(onChange).toHaveBeenCalledWith(`${origin}/spa-route`);
    stop();
  });

  it('reports a title text-node change as a signal', async () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/text-node');
    const title = document.head.querySelector('title');
    if (title?.firstChild) title.firstChild.nodeValue = 'Changed';
    await flushMutations();

    expect(onChange).toHaveBeenCalledWith(`${origin}/text-node`);
    stop();
  });

  it('ignores hash-only changes and signals without a page-key change', async () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '#section');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    document.title = 'Same page';
    await flushMutations();

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('reports each distinct key once', () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/a');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.history.pushState(null, '', '/b');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onChange.mock.calls).toEqual([[`${origin}/a`], [`${origin}/b`]]);
    stop();
  });

  it('stops reporting after teardown', async () => {
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);
    stop();

    window.history.pushState(null, '', '/after');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    document.title = 'After';
    await flushMutations();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('observes the document element when the document has no head', async () => {
    document.head.remove();
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/headless');
    document.documentElement.append(document.createElement('g'));
    await flushMutations();

    expect(onChange).toHaveBeenCalledWith(`${origin}/headless`);
    stop();
  });
});

describe('watchRoute interval re-check', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a pushState that changes nothing in the head within 500 ms, once', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.pushState(null, '', '/silent');
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(2000);

    expect(onChange.mock.calls).toEqual([[`${origin}/silent`]]);
    stop();
  });

  it('reports a replaceState route change the same way', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);

    window.history.replaceState(null, '', '/replaced');
    vi.advanceTimersByTime(500);

    expect(onChange.mock.calls).toEqual([[`${origin}/replaced`]]);
    stop();
  });

  it('stops the interval on teardown', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchRoute(window, onChange);
    stop();

    window.history.pushState(null, '', '/after-stop');
    vi.advanceTimersByTime(2000);

    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
