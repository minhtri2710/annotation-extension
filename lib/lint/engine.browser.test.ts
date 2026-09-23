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

// A setTimeout(0) heartbeat: the longest gap between beats is the longest main-thread stretch.
function heartbeat(): () => number {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const beat = (): void => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) setTimeout(beat, 0);
  };
  setTimeout(beat, 0);
  return () => {
    running = false;
    return Math.max(longest, performance.now() - last);
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('lint engine on a large page (real browser)', () => {
  it('keeps every main-thread stretch of a full scan under 100 ms', async () => {
    await buildFixture(FIXTURE_ELEMENTS);
    const stop = heartbeat();

    await collectFindings([...ALL_RULES], createScanContext(window), new AbortController().signal);
    const longest = stop();

    expect(longest).toBeLessThan(MAX_STRETCH_MS);
  }, 60_000);

  it('rejects within 100 ms when aborted during the page phase', async () => {
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
    expect(rejectedAfter).toBeLessThan(MAX_STRETCH_MS);
  }, 60_000);

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
