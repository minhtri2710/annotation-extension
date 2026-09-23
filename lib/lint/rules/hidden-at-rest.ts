import type { Checkpoint, PageHit, PageRule, Rule, ScanContext } from '../engine';

const MIN_TOTAL_CHARS = 200;
const MIN_HIDDEN_CHARS = 150;
const MAX_QUIET_SHARE = 0.3;
const MAX_HIDDEN_OPACITY = 0.02;
const SAMPLE_LENGTH = 40;
const EXCLUDED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'title',
  'head',
  'meta',
  'link',
  'option',
  'optgroup',
  'select',
  'datalist',
  'dialog',
]);
const HIDDEN_VISIBILITY_RE = /^(hidden|collapse)$/;

type HiddenState = 'visible' | 'invisible' | 'excluded';

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function opacityOrZero(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) || parsed === 0 ? 0 : parsed;
}

async function measureHiddenText(ctx: ScanContext, checkpoint: Checkpoint): Promise<{ total: number; hidden: number; sample?: string }> {
  const root = ctx.doc.documentElement;
  const cache = new Map<Element, HiddenState>();
  const stateOf = (el: Element | null): HiddenState => {
    if (!el || el === root) return 'visible';
    const cached = cache.get(el);
    if (cached) return cached;
    let state: HiddenState;
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) {
      state = 'excluded';
    } else {
      const parent = stateOf(el.parentElement);
      const style = ctx.style(el);
      if (parent === 'excluded') {
        state = 'excluded';
      } else if (
        style.getPropertyValue('display') === 'none' ||
        (el instanceof HTMLElement && el.hidden) ||
        el.getAttribute('aria-hidden') === 'true' ||
        style.getPropertyValue('content-visibility').toLowerCase() === 'hidden'
      ) {
        state = 'excluded';
      } else if (parent === 'invisible' || opacityOrZero(style.getPropertyValue('opacity')) <= MAX_HIDDEN_OPACITY) {
        state = 'invisible';
      } else {
        state = 'visible';
      }
    }
    cache.set(el, state);
    return state;
  };

  let total = 0;
  let hidden = 0;
  let sample: string | undefined;
  for (const el of ctx.doc.querySelectorAll('body *')) {
    await checkpoint();
    let length = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === node.TEXT_NODE) length += collapse(node.textContent ?? '').length;
    }
    if (length === 0) continue;
    // Visibility inherits and a descendant can override it, so it is judged on the text's own element.
    if (HIDDEN_VISIBILITY_RE.test(ctx.style(el).getPropertyValue('visibility'))) continue;
    const state = stateOf(el);
    if (state === 'excluded') continue;
    total += length;
    if (state === 'invisible') {
      hidden += length;
      sample ||= collapse(el.textContent ?? '').slice(0, SAMPLE_LENGTH) || undefined;
    }
  }
  return { total, hidden, sample };
}

const contentHiddenAtRest: PageRule = {
  id: 'content-hidden-at-rest',
  category: 'quality',
  severity: 'error',
  name: 'Content invisible at rest',
  description:
    'A large share of the page text sits at opacity 0 even after every reveal handler had a chance to run. This is the failed-reveal signature: the content shipped but never becomes visible. Make content visible by default and let JavaScript enhance its entrance instead of gating its existence.',
  scope: 'page',
  async test(ctx, checkpoint): Promise<PageHit[]> {
    const { total, hidden, sample } = await measureHiddenText(ctx, checkpoint);
    if (total < MIN_TOTAL_CHARS || hidden < MIN_HIDDEN_CHARS) return [];
    const share = hidden / total;
    if (share <= MAX_QUIET_SHARE) return [];
    const example = sample === undefined ? '' : ` (e.g. "${sample}")`;
    return [
      {
        detail: `${Math.round(share * 100)}% of page text (${hidden} of ${total} chars) stays at opacity 0 after reveal handlers ran${example}`,
      },
    ];
  },
};

export const hiddenAtRestRules: Rule[] = [contentHiddenAtRest];
