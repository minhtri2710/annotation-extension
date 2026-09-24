import { hasChroma, isNeutralColor, parseColor } from '../color';
import { cssColorAlpha, parsePx, roundTo } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const SIDE_TAB_MIN_RECT_WIDTH_PX = 20;
const SIDE_TAB_MIN_RECT_HEIGHT_PX = 20;
const SIDE_TAB_PSEUDO_MIN_RECT_WIDTH_PX = 40;
const SIDE_TAB_PSEUDO_MIN_RECT_HEIGHT_PX = 20;
const SIDE_TAB_MIN_WIDTH_PX = 1;
const SIDE_TAB_ASYMMETRY_MIN_PX = 2;
const SIDE_TAB_INSET_MAX_BOX_WIDTH_PX = 40;
const SIDE_TAB_MIN_STRIPE_PX = 3;
const SIDE_TAB_MAX_STRIPE_PX = 12;
const SIDE_TAB_MIN_CHROMA = 30;
const SIDE_TAB_PSEUDO_MIN_ALPHA = 0.1;
const SIDE_TAB_PSEUDO_EDGE_TOLERANCE_PX = 2;
const SIDE_TAB_PSEUDO_FULL_EDGE_GAP_PX = 44;
const SIDE_TAB_PSEUDO_MIN_EDGE_RATIO = 0.5;
const BORDER_ACCENT_MIN_PX = 2;
const GPT_THIN_BORDER_MAX_PX = 1.5;
const GPT_THIN_BORDER_MIN_ALPHA = 0.28;
const GPT_THIN_BORDER_MIN_SIDES = 2;
const GPT_SHADOW_MIN_ALPHA = 0.12;
const GPT_SHADOW_MIN_BLUR_PX = 16;
const GRID_MIN_HAIRLINE_COUNT = 2;

const BORDER_SAFE_TAGS = new Set([
  'blockquote',
  'nav',
  'a',
  'input',
  'textarea',
  'select',
  'pre',
  'code',
  'span',
  'th',
  'td',
  'tr',
  'li',
  'button',
  'hr',
  'html',
  'head',
  'body',
  'script',
  'style',
  'link',
  'meta',
  'title',
  'br',
  'img',
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'g',
  'defs',
  'use',
]);

function styleValue(ctx: ScanContext, el: Element, property: string, pseudo?: string): string {
  return ctx.style(el, pseudo).getPropertyValue(property).trim();
}

function numericStyle(
  ctx: ScanContext,
  el: Element,
  property: string,
  pseudo?: string,
): number {
  const raw = styleValue(ctx, el, property, pseudo);
  if (!raw) return property === 'opacity' ? 1 : 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function rectSize(el: Element): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function classSelector(el: Element): string {
  const tag = el.tagName.toLowerCase() || 'el';
  const classes = [...el.classList].filter(Boolean);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

function isTabContext(el: Element): boolean {
  if (el.closest('[aria-selected="true"], [aria-current]:not([aria-current="false"])')) {
    return true;
  }
  let current: Element | null = el;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (/(?:^|[\s_-])(?:active|current|selected)(?:$|[\s_-])/i.test(current.className)) {
      return true;
    }
  }
  return false;
}

function isStatusContext(el: Element): boolean {
  return el.closest('[role="status"], [role="alert"], [role="alertdialog"], [role="log"], [aria-live="polite"], [aria-live="assertive"]') !== null;
}

function isRendered(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const style = ctx.style(current);
    if (
      styleValue(ctx, current, 'display') === 'none'
      || /^(?:hidden|collapse)$/i.test(styleValue(ctx, current, 'visibility'))
      || numericStyle(ctx, current, 'opacity') <= 0.01
      || styleValue(ctx, current, 'content-visibility') === 'hidden'
      || style.display === 'none'
    ) return false;
    current = current.parentElement;
  }
  return true;
}

function borderWidths(ctx: ScanContext, el: Element): number[] {
  return ['top', 'right', 'bottom', 'left'].map((side) => (
    parsePx(styleValue(ctx, el, `border-${side}-width`)) ?? 0
  ));
}

function borderColors(ctx: ScanContext, el: Element): string[] {
  return ['top', 'right', 'bottom', 'left'].map((side) => (
    styleValue(ctx, el, `border-${side}-color`)
  ));
}

interface BorderHit {
  rule: 'side-tab' | 'border-accent-on-rounded';
  hit: RuleHit;
}

function borderHits(el: Element, ctx: ScanContext): BorderHit[] {
  const tag = el.tagName.toLowerCase();
  const spanBadge = tag === 'span' && (parseColor(styleValue(ctx, el, 'background-color'))?.a ?? 0) > 0.1;
  if ((BORDER_SAFE_TAGS.has(tag) && !spanBadge) || isStatusContext(el)) return [];
  const { width, height } = rectSize(el);
  if (width < SIDE_TAB_MIN_RECT_WIDTH_PX || height < SIDE_TAB_MIN_RECT_HEIGHT_PX) return [];

  const widths = borderWidths(ctx, el);
  const colors = borderColors(ctx, el);
  const radius = parsePx(styleValue(ctx, el, 'border-radius')) ?? 0;
  const hits: BorderHit[] = [];
  const sides = ['top', 'right', 'bottom', 'left'] as const;

  sides.forEach((side, index) => {
    const borderWidth = widths[index]!;
    const color = colors[index];
    if (borderWidth < SIDE_TAB_MIN_WIDTH_PX || isNeutralColor(color)) return;
    const otherWidths = widths.filter((_, otherIndex) => otherIndex !== index);
    const maxOther = Math.max(...otherWidths);
    if (
      borderWidth < SIDE_TAB_ASYMMETRY_MIN_PX
      || !(maxOther <= 1 || borderWidth >= maxOther * 2)
    ) return;

    if (side === 'right' || side === 'left') {
      if (spanBadge) return;
      if (radius > 0) {
        hits.push({
          rule: 'side-tab',
          hit: { detail: `border-${side}: ${borderWidth}px + border-radius: ${radius}px` },
        });
      } else if (borderWidth >= SIDE_TAB_MIN_STRIPE_PX) {
        hits.push({ rule: 'side-tab', hit: { detail: `border-${side}: ${borderWidth}px` } });
      }
      return;
    }
    if (radius > 0 && borderWidth >= BORDER_ACCENT_MIN_PX) {
      hits.push({
        rule: 'border-accent-on-rounded',
        hit: { detail: `border-${side}: ${borderWidth}px + border-radius: ${radius}px` },
      });
    } else if (!isTabContext(el) && borderWidth >= SIDE_TAB_MIN_STRIPE_PX && borderWidth <= SIDE_TAB_MAX_STRIPE_PX) {
      hits.push({ rule: 'side-tab', hit: { detail: `border-${side}: ${borderWidth}px` } });
    }
  });
  return hits;
}

function pseudoStripeHits(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  if (BORDER_SAFE_TAGS.has(tag) || tag === 'summary' || el.closest('nav, blockquote, pre')) return [];
  if (!isRendered(ctx, el) || isTabContext(el)) return [];
  const rect = el.getBoundingClientRect();
  if (rect.width < SIDE_TAB_PSEUDO_MIN_RECT_WIDTH_PX || rect.height < SIDE_TAB_PSEUDO_MIN_RECT_HEIGHT_PX) return [];
  const hits: RuleHit[] = [];

  for (const pseudo of ['::before', '::after']) {
    const content = styleValue(ctx, el, 'content', pseudo);
    if (!content || content === 'none') continue;
    if (!['absolute', 'fixed'].includes(styleValue(ctx, el, 'position', pseudo))) continue;
    if (numericStyle(ctx, el, 'opacity', pseudo) <= 0.01 || styleValue(ctx, el, 'display', pseudo) === 'none') continue;
    const width = numericStyle(ctx, el, 'width', pseudo);
    const height = numericStyle(ctx, el, 'height', pseudo);
    if (!(width > 0 && height > 0)) continue;
    const hugs = (value: string): boolean => {
      const number = Number.parseFloat(value);
      return Number.isFinite(number)
        && number >= -SIDE_TAB_PSEUDO_EDGE_TOLERANCE_PX
        && number <= SIDE_TAB_PSEUDO_EDGE_TOLERANCE_PX;
    };
    const left = styleValue(ctx, el, 'left', pseudo);
    const right = styleValue(ctx, el, 'right', pseudo);
    const top = styleValue(ctx, el, 'top', pseudo);
    const bottom = styleValue(ctx, el, 'bottom', pseudo);
    let edge: string | undefined;
    let thickness = 0;
    if (
      width >= SIDE_TAB_MIN_STRIPE_PX
      && width <= SIDE_TAB_MAX_STRIPE_PX
      && height >= rect.height - SIDE_TAB_PSEUDO_FULL_EDGE_GAP_PX
      && height >= rect.height * SIDE_TAB_PSEUDO_MIN_EDGE_RATIO
    ) {
      edge = hugs(left) ? 'left' : hugs(right) ? 'right' : undefined;
      thickness = width;
    }
    if (
      edge === undefined
      && height >= SIDE_TAB_MIN_STRIPE_PX
      && height <= SIDE_TAB_MAX_STRIPE_PX
      && width >= rect.width - SIDE_TAB_PSEUDO_FULL_EDGE_GAP_PX
      && width >= rect.width * SIDE_TAB_PSEUDO_MIN_EDGE_RATIO
      && !/(?:^|[\s_-])(?:btn|button|link)(?:$|[\sA-Za-z0-9_-])/i.test(el.className)
    ) {
      edge = hugs(top) ? 'top' : hugs(bottom) ? 'bottom' : undefined;
      thickness = height;
    }
    if (!edge) continue;
    const color = parseColor(styleValue(ctx, el, 'background-color', pseudo));
    if (!color || color.a < SIDE_TAB_PSEUDO_MIN_ALPHA || !hasChroma(color, SIDE_TAB_MIN_CHROMA)) continue;
    hits.push({
      detail: `${classSelector(el)}${pseudo} — absolute ${thickness}px pseudo-element stripe (${edge})`,
    });
  }
  return hits;
}

function sideTabTest(el: Element, ctx: ScanContext): RuleHit[] {
  return [
    ...borderHits(el, ctx)
      .filter((entry) => entry.rule === 'side-tab')
      .map((entry) => entry.hit),
    ...pseudoStripeHits(el, ctx),
    ...insetStripeHits(el, ctx),
  ];
}

function borderAccentTest(el: Element, ctx: ScanContext): RuleHit[] {
  return borderHits(el, ctx)
    .filter((entry) => entry.rule === 'border-accent-on-rounded')
    .map((entry) => entry.hit);
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function shadowNumbers(layer: string): number[] {
  const withoutColors = layer
    .replace(/(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\([^)]*\)/gi, ' ')
    .replace(/#[\da-f]{3,8}/gi, ' ');
  return [...withoutColors.matchAll(/(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?/gi)].map((match) => {
    const number = Number.parseFloat(match[1]!);
    const unit = match[2]?.toLowerCase();
    return unit === 'rem' || unit === 'em' ? number * 16 : number;
  });
}

function shadowMaxBlur(value: string): number {
  if (!value || value.toLowerCase() === 'none') return 0;
  let maxBlur = 0;
  for (const layer of splitTopLevel(value)) {
    const colors = [...layer.matchAll(/(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\([^)]*\)|#[\da-f]{3,8}/gi)];
    const hasEnoughAlpha = colors.length === 0 || colors.some((match) => cssColorAlpha(match[0]!) >= GPT_SHADOW_MIN_ALPHA);
    if (!hasEnoughAlpha) continue;
    const numbers = shadowNumbers(layer);
    if (numbers.length >= 3) maxBlur = Math.max(maxBlur, numbers[2]!);
  }
  return maxBlur;
}

function gptBorderShadowTest(el: Element, ctx: ScanContext): RuleHit[] {
  const widths = borderWidths(ctx, el);
  const colors = borderColors(ctx, el);
  const visible = widths.filter((width, index) => (
    width > 0
    && width <= GPT_THIN_BORDER_MAX_PX
    && cssColorAlpha(colors[index] ?? '') >= GPT_THIN_BORDER_MIN_ALPHA
  ));
  if (visible.length < GPT_THIN_BORDER_MIN_SIDES) return [];
  const blur = shadowMaxBlur(styleValue(ctx, el, 'box-shadow'));
  if (blur < GPT_SHADOW_MIN_BLUR_PX) return [];
  const maxBorder = Math.max(...visible);
  return [{ detail: `${maxBorder}px border + ${roundTo(blur)}px shadow blur` }];
}

interface InsetStripeCandidate {
  selector: string;
  detail: { thickness: number; edge: string };
}

interface StylesheetCache {
  sources?: string[];
  insetStripeCandidates?: InsetStripeCandidate[];
}

const stylesheetCaches = new WeakMap<ScanContext, StylesheetCache>();

function stylesheetCache(ctx: ScanContext): StylesheetCache {
  let cache = stylesheetCaches.get(ctx);
  if (!cache) {
    cache = {};
    stylesheetCaches.set(ctx, cache);
  }
  return cache;
}

function stylesheetSources(ctx: ScanContext): string[] {
  const cache = stylesheetCache(ctx);
  if (cache.sources) return cache.sources;

  const sources: string[] = [];
  const inlineSheets = new Set<CSSStyleSheet>();
  for (const style of Array.from(ctx.doc.querySelectorAll('style'))) {
    if (style.textContent) sources.push(style.textContent);
    if (style.sheet) inlineSheets.add(style.sheet);
  }
  for (const el of Array.from(ctx.doc.querySelectorAll('[style]'))) {
    const value = el.getAttribute('style');
    if (value) sources.push(`style="${value}"`);
  }
  for (const sheet of Array.from(ctx.doc.styleSheets)) {
    if (inlineSheets.has(sheet)) continue;
    try {
      const rules = sheet.cssRules;
      for (const rule of Array.from(rules)) sources.push(rule.cssText);
    } catch {
      // Cross-origin stylesheets intentionally provide no readable same-document CSS.
    }
  }
  cache.sources = sources;
  return sources;
}

interface CssSourceRule {
  selector: string;
  declarations: string;
}

function sourceBlocks(source: string): string[] {
  const blocks: string[] = [];
  const blockPattern = /\{([^{}]*)\}/g;
  for (const match of source.matchAll(blockPattern)) {
    if (match[1] !== undefined) blocks.push(match[1]);
  }
  if (!source.includes('{')) blocks.push(source);
  return blocks;
}

function sourceRules(source: string): CssSourceRule[] {
  const rules: CssSourceRule[] = [];
  const rulePattern = /(?:^|})\s*([^@{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rulePattern)) {
    const selector = match[1]?.trim();
    const declarations = match[2];
    if (selector && declarations !== undefined) rules.push({ selector, declarations });
  }
  return rules;
}

function declarationValue(declarations: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'i').exec(declarations)?.[1]?.trim();
}

function shadowColor(value: string): ReturnType<typeof parseColor> {
  const match = /#[\da-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\([^)]*\)/i.exec(value);
  return match ? parseColor(match[0]) : undefined;
}

function insetStripeDetail(value: string): { thickness: number; edge: string } | undefined {
  for (const layer of splitTopLevel(value)) {
    if (!/\binset\b/i.test(layer)) continue;
    const color = shadowColor(layer);
    if (!color || color.a < SIDE_TAB_PSEUDO_MIN_ALPHA || !hasChroma(color, SIDE_TAB_MIN_CHROMA)) continue;
    const values = shadowNumbers(layer);
    const x = values[0] ?? 0;
    const y = values[1] ?? 0;
    const blur = values[2] ?? 0;
    const spread = values[3] ?? 0;
    if (blur !== 0 || spread !== 0) continue;
    const horizontal = Math.abs(x) >= SIDE_TAB_MIN_STRIPE_PX && Math.abs(x) <= SIDE_TAB_MAX_STRIPE_PX && y === 0;
    const vertical = Math.abs(y) >= SIDE_TAB_MIN_STRIPE_PX && Math.abs(y) <= SIDE_TAB_MAX_STRIPE_PX && x === 0;
    if (!horizontal && !vertical) continue;
    return {
      thickness: horizontal ? Math.abs(x) : Math.abs(y),
      edge: horizontal ? (x > 0 ? 'left' : 'right') : (y > 0 ? 'top' : 'bottom'),
    };
  }
  return undefined;
}

function insetStripeCandidates(ctx: ScanContext): InsetStripeCandidate[] {
  const cache = stylesheetCache(ctx);
  if (cache.insetStripeCandidates) return cache.insetStripeCandidates;

  const candidates: InsetStripeCandidate[] = [];
  const seen = new Set<string>();
  for (const source of stylesheetSources(ctx)) {
    for (const rule of sourceRules(source)) {
      for (const selector of rule.selector.split(',')) {
        const trimmed = selector.trim();
        if (!trimmed || /:(?:hover|active|focus|visited|target|before|after)\b/i.test(trimmed)) continue;
        if (/\[(?:aria-selected|aria-current)\s*=|\b(?:button|hr|tr|td|th|table|blockquote|pre|code)\b/i.test(trimmed)) continue;
        const shadow = declarationValue(rule.declarations, 'box-shadow');
        const width = parsePx(
          declarationValue(rule.declarations, 'width')
          ?? declarationValue(rule.declarations, 'inline-size')
          ?? '',
        ) ?? Number.POSITIVE_INFINITY;
        if (!shadow || width <= SIDE_TAB_INSET_MAX_BOX_WIDTH_PX) continue;
        const detail = insetStripeDetail(shadow);
        if (!detail) continue;
        const key = `${trimmed}:${detail.edge}:${detail.thickness}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ selector: trimmed, detail });
      }
    }
  }
  cache.insetStripeCandidates = candidates;
  return candidates;
}

function insetStripeHits(el: Element, ctx: ScanContext): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const candidate of insetStripeCandidates(ctx)) {
    try {
      if (!el.matches(candidate.selector)) continue;
    } catch {
      continue;
    }
    hits.push({
      detail: `${candidate.selector} — inset box-shadow ${candidate.detail.thickness}px stripe (${candidate.detail.edge})`,
    });
  }
  return hits;
}

async function repeatingGradientTest(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const repeating = /repeating-(?:linear|radial|conic)-gradient\s*\(/i;
  const groups = new Map<string, { el: Element; count: number }>();
  for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    const image = styleValue(ctx, el, 'background-image');
    if (!repeating.test(image)) continue;
    const group = groups.get(image);
    if (group) group.count += 1;
    else groups.set(image, { el, count: 1 });
  }
  return Array.from(groups.values(), ({ el, count }) => ({
    detail: `repeating-gradient decorative stripes${count > 1 ? ` (${count} elements)` : ''}`,
    el,
  }));
}

function hasGridBackground(block: string): boolean {
  const backgroundValues = [...block.matchAll(/\bbackground(?:-image)?\s*:\s*([^;}]*)/gi)].map((match) => match[1] ?? '');
  let hairlineCount = 0;
  for (const value of backgroundValues) {
    hairlineCount += (value.match(/\b\d{1,3}px\s*,\s*transparent\s+\d{1,3}px/gi) ?? []).length;
    hairlineCount += (value.match(/transparent\s+calc\(\s*100%\s*-\s*\d{1,3}px\s*\)/gi) ?? []).length;
  }
  if (hairlineCount < GRID_MIN_HAIRLINE_COUNT) return false;
  const hasSizeCell = /\bbackground-size\s*:[^;}]*(?:\d{1,3}px)/i.test(block)
    || /\/\s*\d{1,3}px\b/i.test(backgroundValues.join(';'));
  return hasSizeCell;
}

async function gridBackgroundTest(ctx: ScanContext, checkpoint: Checkpoint): Promise<RuleHit[]> {
  for (const source of stylesheetSources(ctx)) {
    await checkpoint();
    if (sourceBlocks(source).some(hasGridBackground)) return [{ detail: 'two-axis grid-line gradient background' }];
  }
  return [];
}

const sideTabRule: ElementRule = {
  id: 'side-tab',
  category: 'slop',
  severity: 'advisory',
  name: 'Side-tab accent border',
  description: 'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
  scope: 'element',
  test: sideTabTest,
};

const borderAccentRule: ElementRule = {
  id: 'border-accent-on-rounded',
  category: 'slop',
  name: 'Border accent on rounded element',
  description: 'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
  scope: 'element',
  test: borderAccentTest,
};

const gptThinBorderWideShadowRule: ElementRule = {
  id: 'gpt-thin-border-wide-shadow',
  category: 'slop',
  severity: 'advisory',
  name: 'Hairline border with wide shadow',
  description: 'A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.',
  scope: 'element',
  test: gptBorderShadowTest,
};

const repeatingStripesGradientRule: PageRule = {
  id: 'repeating-stripes-gradient',
  category: 'slop',
  severity: 'advisory',
  name: 'Repeating-gradient stripes',
  description: 'Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.',
  scope: 'page',
  test: repeatingGradientTest,
};

const codexGridBackgroundRule: PageRule = {
  id: 'codex-grid-background',
  category: 'slop',
  severity: 'advisory',
  name: 'Decorative grid-line background',
  description: 'A decorative grid or line-field background drawn with hairline linear-gradient layers tiled by a fixed pixel cell is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.',
  scope: 'page',
  test: gridBackgroundTest,
};

export const visualDetailsRules: Rule[] = [
  sideTabRule,
  borderAccentRule,
  gptThinBorderWideShadowRule,
  repeatingStripesGradientRule,
  codexGridBackgroundRule,
];
