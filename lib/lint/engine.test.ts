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
  vi.useRealTimers();
  vi.restoreAllMocks();
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
        skillSection: 'Testing',
        test: (el) => el.matches('.target') ? [{ detail: 'target hit', ignoreValue: 'target' }] : [],
      },
      {
        id: 'fake-page',
        scope: 'page',
        category: 'slop',
        name: 'Fake page rule',
        description: 'Finds the page.',
        test: () => [{ detail: 'page hit' }],
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
        skillSection: 'Testing',
        el: target,
        detail: 'target hit',
        ignoreValue: 'target',
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

  it('applies disabled rules and disabled values', async () => {
    document.body.innerHTML = '<button class="target">Save</button>';
    const target = document.querySelector('.target')!;
    const targetRule: Rule = {
      id: 'fake-target',
      scope: 'element',
      category: 'quality',
      name: 'Target',
      description: 'Target rule.',
      test: (el) => el.matches('.target')
        ? [{ detail: 'keep', ignoreValue: 'keep' }, { detail: 'drop', ignoreValue: 'drop' }]
        : [],
    };
    const disabledRule: Rule = {
      id: 'fake-disabled',
      scope: 'page',
      category: 'quality',
      name: 'Disabled',
      description: 'Disabled rule.',
      test: () => [{ detail: 'disabled' }],
    };

    const findings = await collectFindings([targetRule, disabledRule], createScanContext(window, {
      disabledRules: ['fake-disabled'],
      disabledValues: [{ rule: 'fake-target', value: 'drop' }],
    }), new AbortController().signal);

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({ ruleId: 'fake-target', detail: 'keep' });
    expect(finding?.el).toBe(target);
  });

  it('honors skipScan and caches computed styles', async () => {
    document.body.innerHTML = '<div id="target">Target</div>';
    const element = document.querySelector('#target')!;
    const ctx = createScanContext(window);

    expect(ctx.config.lineLengthMax).toBe(80);
    expect(ctx.style(element)).toBe(ctx.style(element));
    expect(ctx.style(element, '::before')).toBe(ctx.style(element, '::before'));
    expect(await collectFindings([], createScanContext(window, { skipScan: true }), new AbortController().signal)).toEqual([]);
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
      test: () => [{ detail: 'page:a', el: byId('a') }, { detail: 'page:none' }],
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
    const pageTest = vi.fn(() => []);
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
    const pageTest = vi.fn(() => []);
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
});
