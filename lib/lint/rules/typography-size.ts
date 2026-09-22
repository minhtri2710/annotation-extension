import { parsePx, trackingEm } from '../css';
import type { ElementRule, Rule, RuleHit, ScanContext } from '../engine';

const TINY_TEXT_FONT_PX = 12;
const UNDERSIZED_UI_TEXT_FONT_PX = 11;
const UNDERSIZED_UI_SMALLPRINT_FONT_PX = 10;
const ALL_CAPS_BODY_MIN_CHARS = 30;
const WIDE_TRACKING_MAX_EM = 0.05;
const EXTREME_NEGATIVE_TRACKING_MIN_EM = -0.05;
const TIGHT_LEADING_MIN_RATIO = 1.3;
const OVERSIZED_H1_FONT_PX = 72;
const OVERSIZED_H1_MIN_CHARS = 40;
const OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO = 0.28;
const OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO = 0.25;

const NON_RENDERED_TAGS = new Set([
  'script',
  'style',
  'title',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'base',
  'param',
  'source',
  'track',
  'datalist',
  'col',
  'colgroup',
  'map',
  'area',
]);
const TINY_TEXT_SKIP_TAGS = new Set([
  'sub',
  'sup',
  'code',
  'kbd',
  'samp',
  'var',
  'caption',
  'figcaption',
]);
const UI_SKIP_TAGS = new Set(['sub', 'sup', 'option']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const TINY_TEXT_UI_CONTEXT = [
  'button',
  'a',
  'label',
  'summary',
  'pre',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  'nav',
  'footer',
  '[aria-hidden="true"]',
];
const TINY_TEXT_UI_CLASS_WORDS = [
  'badge',
  'caption',
  'chip',
  'code',
  'console',
  'diff',
  'label',
  'meta',
  'mock',
  'pill',
  'preview',
  'tag',
  'terminal',
  'writes',
];
const EXEMPT_CONTEXT = [
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'svg',
  '[aria-hidden="true"]',
];
const EXEMPT_CLASS_WORDS = ['terminal', 'console', 'code', 'mock', 'editor', 'syntax', 'diff'];
const INTERACTIVE_CONTEXT = [
  'a[href]',
  'button',
  'summary',
  'label',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="treeitem"]',
  '[tabindex]',
];
const FURNITURE_CONTEXT = [
  'nav',
  '[role="navigation"]',
  'td',
  'th',
  '[role="gridcell"]',
  '[role="cell"]',
  'caption',
  'figcaption',
  'dt',
  'dd',
  'footer',
];
const FURNITURE_CLASS_WORDS = [
  'meta',
  'label',
  'badge',
  'chip',
  'pill',
  'tag',
  'kicker',
  'eyebrow',
  'breadcrumb',
  'timestamp',
  'category',
  'caption',
  'nav',
];
const SMALLPRINT_CONTEXT = [
  'small',
  'footer',
  '[class*="legal" i]',
  '[class*="copyright" i]',
  '[class*="fineprint" i]',
  '[class*="fine-print" i]',
  '[class*="smallprint" i]',
  '[class*="small-print" i]',
  '[class*="disclaimer" i]',
  '[class*="disclosure" i]',
  '[class*="footnote" i]',
];

function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('');
}

function hasDirectTextLongerThan(el: Element, min: number): boolean {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .some((node) => (node.textContent ?? '').trim().length > min);
}

function textLength(el: Element): number {
  return (el.textContent ?? '').trim().length;
}

function styleValue(ctx: ScanContext, el: Element, property: string): string {
  const style = ctx.style(el);
  const value = style.getPropertyValue(property);
  if (value) return value.trim();
  const camel = property
    .replace(/^-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const normalized = camel.charAt(0).toLowerCase() + camel.slice(1);
  return (style as unknown as Record<string, string>)[normalized]?.trim() ?? '';
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function fontSize(ctx: ScanContext, el: Element): number {
  return parsePx(styleValue(ctx, el, 'font-size')) ?? 16;
}

function resolvedPx(ctx: ScanContext, el: Element, property: string): number | undefined {
  return parsePx(styleValue(ctx, el, property));
}

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function classContains(el: Element, words: string[]): boolean {
  const classes = (el.getAttribute('class') ?? '').toLowerCase();
  return words.some((word) => classes.includes(word));
}

function matchesOrClosest(el: Element, selectors: string[], classWords: string[] = []): boolean {
  let current: Element | null = el;
  while (current) {
    if (classContains(current, classWords)) return true;
    current = current.parentElement;
  }
  return selectors.some((selector) => {
    try {
      return el.matches(selector) || el.closest(selector) !== null;
    } catch {
      return false;
    }
  });
}

function isNonRendered(ctx: ScanContext, el: Element): boolean {
  if (NON_RENDERED_TAGS.has(tagName(el)) || el.closest('head') !== null) return true;
  const display = styleValue(ctx, el, 'display');
  const visibility = styleValue(ctx, el, 'visibility');
  return display === 'none' || visibility === 'hidden' || visibility === 'collapse';
}

function isVisuallyHidden(ctx: ScanContext, el: Element): boolean {
  const srOnlySelector = '.sr-only, .visually-hidden, .visuallyhidden, .screen-reader, .screen-reader-only, .screenreader, .a11y-hidden, .hidden-visually, [class*="sr-only" i], [class*="visually-hidden" i], [class*="visuallyhidden" i], [class*="screen-reader" i], [class*="screenreader" i]';
  try {
    if (el.matches(srOnlySelector) || el.closest(srOnlySelector) !== null) return true;
  } catch {
    // The selector is static and valid; keep the guard aligned with DOM APIs.
  }

  const position = styleValue(ctx, el, 'position');
  if (position !== 'absolute' && position !== 'fixed') return false;

  const clip = styleValue(ctx, el, 'clip');
  const clipPath = styleValue(ctx, el, 'clip-path') || styleValue(ctx, el, 'clipPath');
  if (/rect\(\s*0/i.test(clip) || /inset\(\s*(?:50%|99|100%)/i.test(clipPath)) return true;

  const width = parsePx(styleValue(ctx, el, 'width'));
  const height = parsePx(styleValue(ctx, el, 'height'));
  const overflow = styleValue(ctx, el, 'overflow');
  return (width === 1 || height === 1) && (overflow === 'hidden' || overflow === 'clip');
}

function hit(detail: string): RuleHit[] {
  return [{ detail }];
}

function tinyText(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = tagName(el);
  const size = fontSize(ctx, el);
  if (
    !hasDirectTextLongerThan(el, 10) ||
    textLength(el) <= 20 ||
    size >= TINY_TEXT_FONT_PX ||
    TINY_TEXT_SKIP_TAGS.has(tag) ||
    matchesOrClosest(el, TINY_TEXT_UI_CONTEXT, TINY_TEXT_UI_CLASS_WORDS) ||
    styleValue(ctx, el, 'text-transform') === 'uppercase' ||
    isNonRendered(ctx, el)
  ) return [];
  return hit(`${size}px body text`);
}

function undersizedUiText(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = tagName(el);
  const direct = directText(el).replace(/\s+/g, ' ').trim();
  const size = fontSize(ctx, el);
  if (
    size <= 0 ||
    size >= UNDERSIZED_UI_TEXT_FONT_PX ||
    direct.length < 2 ||
    UI_SKIP_TAGS.has(tag) ||
    isNonRendered(ctx, el) ||
    matchesOrClosest(el, EXEMPT_CONTEXT, EXEMPT_CLASS_WORDS) ||
    isVisuallyHidden(ctx, el)
  ) return [];

  const interactive = matchesOrClosest(el, INTERACTIVE_CONTEXT);
  const furniture = matchesOrClosest(el, FURNITURE_CONTEXT, FURNITURE_CLASS_WORDS);
  const smallprint = matchesOrClosest(el, SMALLPRINT_CONTEXT);
  const floor = !interactive && smallprint ? UNDERSIZED_UI_SMALLPRINT_FONT_PX : UNDERSIZED_UI_TEXT_FONT_PX;
  if (size >= floor || (!interactive && !furniture && direct.length > 20)) return [];
  return hit(`${size}px functional text "${direct.slice(0, 40)}" (below ${floor}px floor)`);
}

function allCapsBody(el: Element, ctx: ScanContext): RuleHit[] {
  const length = textLength(el);
  if (
    !hasDirectTextLongerThan(el, 10) ||
    length <= ALL_CAPS_BODY_MIN_CHARS ||
    styleValue(ctx, el, 'text-transform') !== 'uppercase' ||
    HEADING_TAGS.has(tagName(el))
  ) return [];
  return hit(`text-transform: uppercase on ${length} chars of body text`);
}

function wideTracking(el: Element, ctx: ScanContext): RuleHit[] {
  const size = fontSize(ctx, el);
  const letterSpacing = resolvedPx(ctx, el, 'letter-spacing');
  if (
    !hasDirectTextLongerThan(el, 10) ||
    textLength(el) <= 20 ||
    styleValue(ctx, el, 'text-transform') === 'uppercase' ||
    letterSpacing === undefined ||
    letterSpacing <= 0 ||
    size <= 0
  ) return [];
  const tracking = trackingEm(letterSpacing, size);
  if (tracking <= WIDE_TRACKING_MAX_EM) return [];
  return hit(`letter-spacing: ${tracking.toFixed(2)}em on body text`);
}

function extremeNegativeTracking(el: Element, ctx: ScanContext): RuleHit[] {
  const size = fontSize(ctx, el);
  const letterSpacing = resolvedPx(ctx, el, 'letter-spacing');
  if (
    !hasDirectTextLongerThan(el, 10) ||
    textLength(el) <= 20 ||
    size <= 0 ||
    letterSpacing === undefined ||
    letterSpacing >= 0
  ) return [];
  const tracking = trackingEm(letterSpacing, size);
  if (tracking > EXTREME_NEGATIVE_TRACKING_MIN_EM) return [];
  const excerpt = collapseWhitespace(el.textContent ?? '').slice(0, 40);
  return hit(`letter-spacing: ${tracking.toFixed(2)}em — "${excerpt}"`);
}

function tightLeading(el: Element, ctx: ScanContext): RuleHit[] {
  const size = fontSize(ctx, el);
  const lineHeight = resolvedPx(ctx, el, 'line-height');
  if (
    !hasDirectTextLongerThan(el, 10) ||
    textLength(el) <= 50 ||
    HEADING_TAGS.has(tagName(el)) ||
    lineHeight === undefined ||
    size <= 0
  ) return [];
  const ratio = lineHeight / size;
  if (ratio <= 0 || ratio >= TIGHT_LEADING_MIN_RATIO) return [];
  return hit(`line-height ${ratio.toFixed(2)}x (need >=1.3)`);
}

function justifiedText(el: Element, ctx: ScanContext): RuleHit[] {
  if (!hasDirectTextLongerThan(el, 10) || styleValue(ctx, el, 'text-align') !== 'justify') return [];
  const hyphens = styleValue(ctx, el, 'hyphens') || styleValue(ctx, el, '-webkit-hyphens');
  if (hyphens === 'auto') return [];
  return hit('text-align: justify without hyphens: auto');
}

function oversizedH1(el: Element, ctx: ScanContext): RuleHit[] {
  const size = fontSize(ctx, el);
  const text = collapseWhitespace(el.textContent ?? '');
  if (tagName(el) !== 'h1' || size < OVERSIZED_H1_FONT_PX || text.length < OVERSIZED_H1_MIN_CHARS) {
    return [];
  }

  const rect = el.getBoundingClientRect();
  let viewportDetail = '';
  if (rect.width > 0 && rect.height > 0 && ctx.innerWidth > 0 && ctx.innerHeight > 0) {
    const heightRatio = rect.height / ctx.innerHeight;
    const areaRatio = (rect.width * rect.height) / (ctx.innerWidth * ctx.innerHeight);
    if (
      heightRatio < OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO &&
      areaRatio < OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO
    ) return [];
    viewportDetail = `, ${Math.round(heightRatio * 100)}vh`;
  }

  return hit(`${Math.round(size)}px h1, ${text.length} chars${viewportDetail} "${text.slice(0, 60)}"`);
}

const rule = (
  id: string,
  category: 'slop' | 'quality',
  name: string,
  description: string,
  test: ElementRule['test'],
  skillSection?: string,
): ElementRule => ({
  id,
  category,
  name,
  description,
  ...(skillSection === undefined ? {} : { skillSection }),
  scope: 'element',
  test,
});

export const typographySizeRules: Rule[] = [
  rule(
    'tiny-text',
    'quality',
    'Tiny body text',
    'Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.',
    tinyText,
  ),
  rule(
    'undersized-ui-text',
    'quality',
    'Undersized functional text',
    'Interactive and content-bearing UI text (links, buttons, nav items, labels, table cells, meta rows, timecodes) below 11px is a legibility failure, not a style choice. WCAG sets no absolute pixel floor, but functional text under 11px is a defensible quality bar: it fails on high-DPI and small viewports and it degrades tap and read targets. The 11px floor holds even inside a footer; only non-interactive legal smallprint gets the softer 10px floor. Being ON the DESIGN.md size ramp does not exempt a value here: adding 8px to the ramp launders the token but not the legibility problem, and that is exactly the escape hatch this rule closes. Exempts sup/sub, visually-hidden (sr-only) text, and code/terminal contexts. Decorative letterspaced micro-labels are still functional and stay in scope.',
    undersizedUiText,
  ),
  rule(
    'all-caps-body',
    'quality',
    'All-caps body text',
    'Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.',
    allCapsBody,
    'Typography',
  ),
  rule(
    'wide-tracking',
    'quality',
    'Wide letter spacing on body text',
    'Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.',
    wideTracking,
  ),
  rule(
    'extreme-negative-tracking',
    'slop',
    'Crushed letter spacing',
    'Letter-spacing pulled tighter than the point where characters keep their own shapes costs legibility. Tighten display type optically, not destructively.',
    extremeNegativeTracking,
    'Typography',
  ),
  rule(
    'tight-leading',
    'quality',
    'Tight line height',
    'Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.',
    tightLeading,
  ),
  rule(
    'justified-text',
    'quality',
    'Justified text',
    'Justified text without hyphenation creates uneven word spacing ("rivers of white"). Use text-align: left for body text, or enable hyphens: auto if you must justify.',
    justifiedText,
  ),
  rule(
    'oversized-h1',
    'slop',
    'Oversized hero headline',
    'A full-sentence headline set at display size ends up dominating the viewport, leaving no room for anything else above the fold. A punchy one- or two-word headline at that size is fine — the problem is a long headline blown up too large. Set long headlines smaller, or tighten the copy.',
    oversizedH1,
    'Typography',
  ),
];
