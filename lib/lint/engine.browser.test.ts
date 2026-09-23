import { afterEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext, type ElementRule, type PageRule, type Rule } from './engine';
import { ALL_RULES } from './rules';

const FIXTURE_ELEMENTS = 20_000;
const MAX_STRETCH_MS = 100;

async function buildFixture(target: number): Promise<void> {
  const main = document.createElement('main');
  main.style.cssText = 'max-width:960px;margin:0 auto;padding:16px';
  document.body.append(main);
  for (let i = 0; document.querySelectorAll('*').length < target; i += 1) {
    const section = document.createElement('section');
    section.style.cssText = `padding:${8 + (i % 4) * 4}px;margin:12px 0;border:1px solid #ddd;border-radius:6px`;
    section.innerHTML = `<h2 style="font-size:${20 + (i % 3) * 2}px">Section ${i}</h2>`
      + `<p>Paragraph ${i} with <a href="#s${i}">a link</a>, <em>emphasis</em> and <span style="font-weight:600">inline style</span>. More words so the line wraps.</p>`
      + `<table><tr><th>A</th><th>B</th></tr>${'<tr><td>1</td><td style="text-align:right">2</td></tr>'.repeat(3)}</table>`
      + '<ul><li>One<ul><li>Nested a</li><li>Nested b</li></ul></li><li>Two</li></ul>';
    main.append(section);
  }
  // Settle the fixture's first style and layout pass so it is not charged to the scan.
  document.body.getBoundingClientRect();
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

const nativeSetTimeout = globalThis.setTimeout;

// A setTimeout(0) heartbeat: the longest gap between beats, including engine and machine-load time. Printed, not asserted.
function heartbeat(): () => number {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const beat = (): void => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) nativeSetTimeout(beat, 0);
  };
  nativeSetTimeout(beat, 0);
  return () => {
    running = false;
    return Math.max(longest, performance.now() - last);
  };
}

// The scan yields only through setTimeout, so a synchronous stretch of our code runs from a timer callback
// (or the call) to the next setTimeout call. Scheduling delay between tasks is not counted.
function yieldStretches(): () => number {
  let stretchStart = performance.now();
  let longest = 0;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    longest = Math.max(longest, performance.now() - stretchStart);
    return nativeSetTimeout(() => {
      stretchStart = performance.now();
      handler(...args);
    }, ms);
  }) as typeof setTimeout;
  return () => {
    globalThis.setTimeout = nativeSetTimeout;
    return Math.max(longest, performance.now() - stretchStart);
  };
}

async function scanStretches(rules: Rule[]): Promise<{ stretch: number; gap: number }> {
  const stopHeartbeat = heartbeat();
  const stopStretches = yieldStretches();
  await collectFindings(rules, createScanContext(window), new AbortController().signal);
  const stretch = stopStretches();
  const gap = stopHeartbeat();
  console.info(`longest stretch ${stretch.toFixed(1)} ms, longest heartbeat gap ${gap.toFixed(1)} ms`);
  return { stretch, gap };
}

const ATTEMPTS = 5;
const IDLE_BETWEEN_ATTEMPTS_MS = 1_000;

// OS preemption only adds wall time, so a spec passes once one attempt, on a fresh fixture, is within budget.
async function bestOf(measure: () => Promise<{ ms: number; note: string }>): Promise<{ best: number; notes: string }> {
  const results: { ms: number; note: string }[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // Idle between attempts so one burst of external load does not inflate them all.
    if (attempt > 0) await new Promise((resolve) => nativeSetTimeout(resolve, IDLE_BETWEEN_ATTEMPTS_MS));
    document.body.replaceChildren();
    results.push(await measure());
    if (results[attempt]!.ms < MAX_STRETCH_MS) break;
  }
  return { best: Math.min(...results.map((r) => r.ms)), notes: results.map((r) => r.note).join('; ') };
}

afterEach(() => {
  globalThis.setTimeout = nativeSetTimeout;
  document.body.replaceChildren();
});

describe('lint engine on a large page (real browser)', () => {
  it('keeps every main-thread stretch of a full scan under 100 ms', async () => {
    const { best, notes } = await bestOf(async () => {
      await buildFixture(FIXTURE_ELEMENTS);
      const { stretch, gap } = await scanStretches([...ALL_RULES]);
      return { ms: stretch, note: `stretch ${stretch.toFixed(1)} ms (heartbeat gap ${gap.toFixed(1)} ms)` };
    });

    expect(best, notes).toBeLessThan(MAX_STRETCH_MS);
  }, 300_000);

  it('measures a stretch over budget when a page rule never checkpoints', async () => {
    await buildFixture(2_000);
    const stuck: PageRule = {
      id: 'stuck', scope: 'page', category: 'quality', name: 'stuck', description: 'Busy for the whole budget.',
      test: async () => {
        const start = performance.now();
        while (performance.now() - start < MAX_STRETCH_MS);
        return [];
      },
    };

    const { stretch } = await scanStretches([...ALL_RULES, stuck]);

    expect(stretch).toBeGreaterThanOrEqual(MAX_STRETCH_MS);
  }, 60_000);

  it('rejects within 100 ms when aborted during the page phase', async () => {
    const { best, notes } = await bestOf(async () => {
      await buildFixture(FIXTURE_ELEMENTS);
      const controller = new AbortController();
      const reason = new Error('closed during page phase');
      let abortRequestedAt = 0;
      let occlusionCompleted = false;
      const laterPageRules: string[] = [];
      const rules: Rule[] = ALL_RULES.map((rule) => {
        if (rule.scope !== 'page') return rule;
        const wrapped: PageRule = {
          ...rule,
          test: (ctx, checkpoint) => {
            if (rule.id !== 'text-occlusion') {
              if (abortRequestedAt > 0) laterPageRules.push(rule.id);
              return rule.test(ctx, checkpoint);
            }
            abortRequestedAt = performance.now();
            setTimeout(() => controller.abort(reason), 0);
            const hits = rule.test(ctx, checkpoint);
            hits.then(() => { occlusionCompleted = true; }, () => undefined);
            return hits;
          },
        };
        return wrapped;
      });

      const outcome = await collectFindings(rules, createScanContext(window), controller.signal)
        .then(() => 'resolved', (error: unknown) => error);
      const rejectedAfter = performance.now() - abortRequestedAt;

      expect(abortRequestedAt).toBeGreaterThan(0);
      expect(outcome).toBe(reason);
      expect(occlusionCompleted).toBe(false);
      expect(laterPageRules).toEqual([]);
      return { ms: rejectedAfter, note: `rejected after ${rejectedAfter.toFixed(1)} ms` };
    });

    expect(best, notes).toBeLessThan(MAX_STRETCH_MS);
  }, 300_000);

  it('reads innerText only from p and li elements during the element phase', async () => {
    await buildFixture(2_000);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')!;
    const readers = new Set<string>();
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      ...descriptor,
      get(this: HTMLElement) {
        readers.add(this.tagName.toLowerCase());
        return descriptor.get!.call(this);
      },
    });
    try {
      const elementRules = ALL_RULES.filter((rule): rule is ElementRule => rule.scope === 'element');
      await collectFindings(elementRules, createScanContext(window), new AbortController().signal);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor);
    }

    expect([...readers].filter((tag) => tag !== 'p' && tag !== 'li')).toEqual([]);
    expect(readers.size).toBeGreaterThan(0);
  }, 60_000);

  it('checkpoints between style-attribute reads while building the CSS sources on a large page', async () => {
    await buildFixture(FIXTURE_ELEMENTS);
    const styled = document.querySelectorAll('[style]').length;
    const rule = ALL_RULES.find((candidate): candidate is PageRule => candidate.id === 'organic-clip-path' && candidate.scope === 'page')!;
    const getAttribute = Element.prototype.getAttribute;
    let readsSinceCheckpoint = 0;
    let longestRun = 0;
    let reads = 0;
    Element.prototype.getAttribute = function (this: Element, name: string) {
      if (name === 'style') {
        reads += 1;
        readsSinceCheckpoint += 1;
        longestRun = Math.max(longestRun, readsSinceCheckpoint);
      }
      return getAttribute.call(this, name);
    };
    try {
      await rule.test(createScanContext(window), async () => {
        readsSinceCheckpoint = 0;
      });
    } finally {
      Element.prototype.getAttribute = getAttribute;
    }

    expect(styled).toBeGreaterThan(4_000);
    expect(reads).toBe(styled);
    expect(longestRun).toBe(1);
  }, 60_000);
});
