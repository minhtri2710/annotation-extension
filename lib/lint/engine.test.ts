// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectFindings,
  createScanContext,
  SCAN_SLICE_MS,
  type ElementRule,
  type Rule,
} from './engine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function tickingRule(log: Element[], clock: { now: number }): ElementRule {
  return {
    id: 'tick',
    scope: 'element',
    category: 'quality',
    name: 'Tick',
    description: 'Advances the clock 5 ms per element.',
    test: (el) => {
      log.push(el);
      clock.now += 5;
      return [];
    },
  };
}

function tenElements(): Element[] {
  document.body.innerHTML = Array.from({ length: 7 }, (_, i) => `<div id="d${i}"></div>`).join('');
  const elements = [...document.querySelectorAll('*')];
  expect(elements).toHaveLength(10);
  return elements;
}

function stubClock(): { now: number } {
  const clock = { now: 0 };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  return clock;
}

describe('lint engine', () => {
  it('collects element and page hits and enriches them with rule metadata', async () => {
    document.body.innerHTML = '<main><button class="target">Save</button></main>';
    const target = document.querySelector('.target')!;
    const ctx = createScanContext(window);
    const rules: Rule[] = [
      {
        id: 'fake-element',
        scope: 'element',
        category: 'quality',
        name: 'Fake element rule',
        description: 'Finds the target element.',
        severity: 'advisory',
        test: (el) => el.matches('.target') ? [{ detail: 'target hit' }] : [],
      },
      {
        id: 'fake-page',
        scope: 'page',
        category: 'slop',
        name: 'Fake page rule',
        description: 'Finds the page.',
        test: async () => [{ detail: 'page hit' }],
      },
    ];

    const findings = await collectFindings(rules, ctx, new AbortController().signal);

    expect(findings).toEqual([
      {
        ruleId: 'fake-element',
        name: 'Fake element rule',
        description: 'Finds the target element.',
        severity: 'advisory',
        category: 'quality',
        advisory: true,
        el: target,
        detail: 'target hit',
      },
      {
        ruleId: 'fake-page',
        name: 'Fake page rule',
        description: 'Finds the page.',
        severity: 'warning',
        category: 'slop',
        advisory: false,
        el: undefined,
        detail: 'page hit',
      },
    ]);
  });

  it('caches computed styles', async () => {
    document.body.innerHTML = '<div id="target">Target</div>';
    const element = document.querySelector('#target')!;
    const ctx = createScanContext(window);

    expect(ctx.style(element)).toBe(ctx.style(element));
    expect(ctx.style(element, '::before')).toBe(ctx.style(element, '::before'));
  });

  it('yields a macrotask once a slice reaches SCAN_SLICE_MS', async () => {
    vi.useFakeTimers();
    const clock = stubClock();
    const elements = tenElements();
    const log: Element[] = [];
    expect(SCAN_SLICE_MS).toBe(12);

    const yieldedAfter: Element[] = [];
    const fakeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
      yieldedAfter.push(log.at(-1)!);
      return fakeSetTimeout(handler, ms);
    }) as typeof setTimeout);

    const pending = collectFindings([tickingRule(log, clock)], createScanContext(window), new AbortController().signal);
    expect(log).toEqual(elements.slice(0, 3));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([]);
    expect(log).toEqual(elements);
    expect(yieldedAfter).toEqual([elements[2], elements[5], elements[8]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the synchronous finding order: elements in document order, rules in order, then page rules', async () => {
    vi.useFakeTimers();
    stubClock();
    document.body.innerHTML = '<section id="s"><p id="p"></p></section><a id="a"></a>';
    const byId = (id: string) => document.getElementById(id)!;
    const rule = (id: string, match: string): Rule => ({
      id, scope: 'element', category: 'quality', name: id, description: id,
      test: (el) => (el.matches(match) ? [{ detail: `${id}:${el.id}` }] : []),
    });
    const page: Rule = {
      id: 'page', scope: 'page', category: 'slop', name: 'page', description: 'page',
      test: async () => [{ detail: 'page:a', el: byId('a') }, { detail: 'page:none' }],
    };

    const pending = collectFindings([page, rule('any', '[id]'), rule('para', 'p, a')], createScanContext(window), new AbortController().signal);
    await vi.runAllTimersAsync();
    const findings = await pending;

    expect(findings.map((f) => [f.ruleId, f.el, f.detail])).toEqual([
      ['any', byId('s'), 'any:s'],
      ['any', byId('p'), 'any:p'],
      ['para', byId('p'), 'para:p'],
      ['any', byId('a'), 'any:a'],
      ['para', byId('a'), 'para:a'],
      ['page', byId('a'), 'page:a'],
      ['page', undefined, 'page:none'],
    ]);
  });

  it('rejects with the abort reason during a yield and runs no further rule', async () => {
    vi.useFakeTimers();
    const clock = stubClock();
    const elements = tenElements();
    const log: Element[] = [];
    const pageTest = vi.fn(async () => []);
    const page: Rule = { id: 'page', scope: 'page', category: 'slop', name: 'page', description: 'page', test: pageTest };
    const controller = new AbortController();
    const reason = new Error('stopped');

    const pending = collectFindings([tickingRule(log, clock), page], createScanContext(window), controller.signal);
    const outcome = pending.then(() => 'resolved', (error: unknown) => error);
    controller.abort(reason);
    await vi.runAllTimersAsync();

    expect(await outcome).toBe(reason);
    expect(log).toEqual(elements.slice(0, 3));
    expect(pageTest).not.toHaveBeenCalled();
  });

  it('runs no rule when the signal is already aborted', async () => {
    const elementTest = vi.fn(() => []);
    const pageTest = vi.fn(async () => []);
    const rules: Rule[] = [
      { id: 'el', scope: 'element', category: 'quality', name: 'el', description: 'el', test: elementTest },
      { id: 'page', scope: 'page', category: 'quality', name: 'page', description: 'page', test: pageTest },
    ];
    const controller = new AbortController();
    const reason = new Error('pre-aborted');
    controller.abort(reason);

    await expect(collectFindings(rules, createScanContext(window), controller.signal)).rejects.toBe(reason);
    expect(elementTest).not.toHaveBeenCalled();
    expect(pageTest).not.toHaveBeenCalled();
  });

  it('skips an element removed from the document during a yield', async () => {
    vi.useFakeTimers();
    const clock = stubClock();
    const elements = tenElements();
    const log: Element[] = [];

    const pending = collectFindings([tickingRule(log, clock)], createScanContext(window), new AbortController().signal);
    expect(log).toEqual(elements.slice(0, 3));
    const removed = document.getElementById('d2')!;
    removed.remove();
    await vi.runAllTimersAsync();
    await pending;

    expect(log).toEqual(elements.filter((el) => el !== removed));
  });

  it('yields inside and between page rules once the shared slice reaches SCAN_SLICE_MS', async () => {
    vi.useFakeTimers();
    const clock = stubClock();
    const events: string[] = [];
    const fakeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
      events.push('yield');
      return fakeSetTimeout(handler, ms);
    }) as typeof setTimeout);
    const looping: Rule = {
      id: 'looping', scope: 'page', category: 'quality', name: 'looping', description: 'looping',
      test: async (_ctx, checkpoint) => {
        for (let i = 0; i < 6; i += 1) {
          await checkpoint();
          events.push(`loop${i}`);
          clock.now += 5;
        }
        return [{ detail: 'looping done' }];
      },
    };
    const next: Rule = {
      id: 'next', scope: 'page', category: 'quality', name: 'next', description: 'next',
      test: async () => {
        events.push('next');
        return [{ detail: 'next done' }];
      },
    };

    const pending = collectFindings([looping, next], createScanContext(window), new AbortController().signal);
    await vi.runAllTimersAsync();
    const findings = await pending;

    expect(findings.map((f) => f.detail)).toEqual(['looping done', 'next done']);
    expect(events).toEqual(['loop0', 'loop1', 'loop2', 'yield', 'loop3', 'loop4', 'loop5', 'yield', 'next']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the abort reason during a page-phase yield and runs no further page rule', async () => {
    vi.useFakeTimers();
    const clock = stubClock();
    const iterations: number[] = [];
    const controller = new AbortController();
    const reason = new Error('stopped in page phase');
    const nextTest = vi.fn(async () => []);
    const looping: Rule = {
      id: 'looping', scope: 'page', category: 'quality', name: 'looping', description: 'looping',
      test: async (_ctx, checkpoint) => {
        for (let i = 0; i < 6; i += 1) {
          await checkpoint();
          iterations.push(i);
          clock.now += 5;
          if (i === 2) controller.abort(reason);
        }
        return [];
      },
    };
    const next: Rule = { id: 'next', scope: 'page', category: 'quality', name: 'next', description: 'next', test: nextTest };

    const pending = collectFindings([looping, next], createScanContext(window), controller.signal);
    const outcome = pending.then(() => 'resolved', (error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await outcome).toBe(reason);
    expect(iterations).toEqual([0, 1, 2]);
    expect(nextTest).not.toHaveBeenCalled();
  });

  it('drops a page hit whose element is removed before the page phase finishes', async () => {
    document.body.innerHTML = '<p id="kept"></p><p id="removed"></p>';
    const kept = document.getElementById('kept')!;
    const removed = document.getElementById('removed')!;
    const early: Rule = {
      id: 'early', scope: 'page', category: 'quality', name: 'early', description: 'early',
      test: async () => [{ detail: 'kept', el: kept }, { detail: 'removed', el: removed }, { detail: 'page' }],
    };
    const remover: Rule = {
      id: 'remover', scope: 'page', category: 'quality', name: 'remover', description: 'remover',
      test: async () => {
        removed.remove();
        return [];
      },
    };

    const findings = await collectFindings([early, remover], createScanContext(window), new AbortController().signal);

    expect(findings.map((f) => [f.detail, f.el])).toEqual([['kept', kept], ['page', undefined]]);
    expect(findings[0]?.el).toBe(kept);
  });

  it('drops an element-phase hit whose element is removed before the scan finishes', async () => {
    document.body.innerHTML = '<p id="kept"></p><p id="removed"></p>';
    const kept = document.getElementById('kept')!;
    const removed = document.getElementById('removed')!;
    const flag: Rule = {
      id: 'flag', scope: 'element', category: 'quality', name: 'flag', description: 'flag',
      test: (el) => (el.tagName === 'P' ? [{ detail: el.id }] : []),
    };
    const remover: Rule = {
      id: 'remover', scope: 'page', category: 'quality', name: 'remover', description: 'remover',
      test: async () => {
        removed.remove();
        return [{ detail: 'page' }];
      },
    };

    const findings = await collectFindings([flag, remover], createScanContext(window), new AbortController().signal);

    expect(findings.map((f) => [f.detail, f.el])).toEqual([['kept', kept], ['page', undefined]]);
  });

  it('runs last on the real setTimeout after earlier tests spied on a fake one', async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, 1000);
});
