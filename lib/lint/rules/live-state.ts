import { parseColor } from '../color';
import { parsePx } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const EDGE_SCROLL_EXTRA_PX = 8;
const EDGE_SCROLL_LEFT_MAX_PX = 4;
const EDGE_MIN_WIDTH_PX = 120;
const EDGE_MIN_HEIGHT_PX = 60;
const EDGE_TOP_VIEWPORT_MULTIPLIER = 2;
const EDGE_MIN_CARD_WIDTH_PX = 80;
const EDGE_MIN_CARD_HEIGHT_PX = 40;
const EDGE_MIN_GUTTER_PX = 6;
const EDGE_FLUSH_GAP_PX = 8;
const EDGE_MAX_NEGATIVE_GAP_PX = -24;
const EDGE_MIN_BACKGROUND_ALPHA = 0.5;
const EDGE_MIN_BORDER_SIDES = 2;

const OCCLUSION_MIN_TEXT_LENGTH = 2;
const OCCLUSION_MIN_RECT_WIDTH_PX = 6;
const OCCLUSION_MIN_RECT_HEIGHT_PX = 6;
const OCCLUSION_MIN_EFFECTIVE_OPACITY = 0.02;
const OCCLUSION_MAX_ANCESTOR_OPACITY = 0.05;
const OCCLUSION_GRID_COLUMN_DIVISOR = 12;
const OCCLUSION_MIN_GRID_COLUMNS = 6;
const OCCLUSION_MAX_GRID_COLUMNS = 30;
const OCCLUSION_GRID_ROW_DIVISOR = 14;
const OCCLUSION_MIN_GRID_ROWS = 1;
const OCCLUSION_MAX_GRID_ROWS = 4;
const OCCLUSION_EDGE_SAMPLE_PX = 1;
const OCCLUSION_TEXT_FRACTION = 0.45;
const OCCLUSION_BOX_FRACTION = 0.3;
const OCCLUSION_MIN_BACKGROUND_ALPHA = 0.6;
const OCCLUSION_MIN_BORDER_ALPHA = 0.3;
const OCCLUSION_HEADLINE_FONT_SIZE_PX = 40;
const OCCLUSION_HEADLINE_MIN_INTERSECTION_PX = 8;
const OCCLUSION_HEADLINE_LINE_INTERSECTION_RATIO = 0.5;
const OCCLUSION_CARD_MIN_WIDTH_PX = 100;
const OCCLUSION_CARD_MAX_WIDTH_VIEWPORT_RATIO = 0.8;
const OCCLUSION_CARD_MIN_HEIGHT_PX = 60;
const OCCLUSION_HEADLINE_MAX_INTERSECTION_RATIO = 0.5;
const OCCLUSION_INLINE_MIN_WIDTH_PX = 12;
const OCCLUSION_INLINE_MIN_HEIGHT_PX = 24;
const OCCLUSION_INLINE_MIN_VERTICAL_PADDING_PX = 24;
const OCCLUSION_INLINE_HEIGHT_LINE_RATIO = 2.2;
const OCCLUSION_INLINE_SIBLING_INTERSECTION_PX = 4;
const SR_ONLY_MAX_TINY_PX = 2;
const SR_ONLY_DEFAULT_FONT_SIZE_PX = 16;
const SR_ONLY_ROOT_FONT_SIZE_PX = 16;
const SR_ONLY_FULL_CLIP_PERCENT = 100;

const FIRST_VIEWPORT_SECTION_MIN_WIDTH_RATIO = 0.5;
const FIRST_VIEWPORT_SECTION_TOP_RATIO = 0.9;
const FIRST_VIEWPORT_COLUMN_MIN_WIDTH_RATIO = 0.25;
const FIRST_VIEWPORT_COLUMN_MAX_WIDTH_RATIO = 0.9;
const FIRST_VIEWPORT_COLUMN_MIN_HEIGHT_PX = 40;
const FIRST_VIEWPORT_COLUMNS_MAX_TOP_DELTA_RATIO = 0.25;
const FIRST_VIEWPORT_TALL_HEIGHT_RATIO = 1.4;
const FIRST_VIEWPORT_SHORT_HEIGHT_RATIO = 1;
const FIRST_VIEWPORT_SIDEBAR_SELECTOR = 'nav, aside, [role="navigation"], [role="complementary"]';

const TEXT_OVERFLOW_MIN_DELTA_PX = 16;

const REPEATED_TEXT_MAX_DESCENDANTS = 250;
const REPEATED_TEXT_MIN_LENGTH = 4;
const REPEATED_TEXT_MAX_LENGTH = 48;
const REPEATED_TEXT_MIN_OCCURRENCES = 3;
const REPEATED_TEXT_MIN_DISTINCT_SIGNATURES = 3;
const REPEATED_TEXT_MIN_BORDER_SIDES = 3;
const REPEATED_TEXT_MIN_BORDER_WIDTH_PX = 1;
const REPEATED_TEXT_MIN_BACKGROUND_ALPHA = 0.1;

const CLIP_ESCAPE_THRESHOLD_PX = 2;

const REPEATED_TEXT_CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'figure',
  'form',
  'fieldset',
  'details',
  'li',
]);
const TEXT_OVERFLOW_SKIP_TAGS = new Set([
  'pre',
  'code',
  'textarea',
  'svg',
  'canvas',
  'select',
  'option',
  'marquee',
]);
const OCCLUSION_TEXT_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'title']);
const REPEATED_TEXT_SKIP_SELECTOR = 'table,select,datalist,nav,menu,[role="navigation"],[role="menu"],[role="menubar"],[role="listbox"],[role="grid"],[role="tablist"],[role="radiogroup"],[aria-hidden="true"]';
const DECORATIVE_IDENTIFIER_RE = /\b(?:art|bg|background|badge|blob|crop|decor|dot|glow|grain|image|mask|ornament|overlay|photo|scrim|shadow|shine|texture)\b/i;
const VIEWPORT_IDENTIFIER_RE = /\b(?:carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)\b/i;
const DEMO_IDENTIFIER_RE = /\b(?:demo-area|demo-stage|demo-viewport)\b/i;
const CAROUSEL_ROLE_RE = /\b(?:carousel|slider)\b/i;
const INTERACTIVE_SELECTOR = 'a[href],button,input,select,summary,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="dialog"],[role="link"],[role="listbox"],[role="menu"],[role="menuitem"],[role="option"],[role="tooltip"]';

function styleValue(ctx: ScanContext, el: Element, property: string): string {
  return ctx.style(el).getPropertyValue(property).trim();
}

function numberValue(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundValue(value: number): number {
  return Math.round(value);
}

function classSelector(el: Element): string {
  const tag = el.tagName.toLowerCase() || 'el';
  const classes = [...el.classList].filter(Boolean);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

function directText(el: Element): string {
  return [...el.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function effectiveOpacity(ctx: ScanContext, el: Element): number {
  let opacity = 1;
  let current: Element | null = el;
  while (current) {
    opacity *= numberValue(styleValue(ctx, current, 'opacity'), 1);
    if (opacity <= OCCLUSION_MIN_EFFECTIVE_OPACITY) return 0;
    current = current.parentElement;
  }
  return opacity;
}

function isRendered(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (current.getAttribute('aria-hidden') === 'true') return false;
    const display = styleValue(ctx, current, 'display').toLowerCase();
    const visibility = styleValue(ctx, current, 'visibility').toLowerCase();
    const contentVisibility = styleValue(ctx, current, 'content-visibility').toLowerCase();
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') return false;
    if (numberValue(styleValue(ctx, current, 'opacity'), 1) <= 0.01) return false;
    if (contentVisibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function isPaintedForOcclusion(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const display = styleValue(ctx, current, 'display').toLowerCase();
    const visibility = styleValue(ctx, current, 'visibility').toLowerCase();
    const contentVisibility = styleValue(ctx, current, 'content-visibility').toLowerCase();
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') return false;
    if (numberValue(styleValue(ctx, current, 'opacity'), 1) <= OCCLUSION_MAX_ANCESTOR_OPACITY) return false;
    if (contentVisibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function hasDirectText(el: Element): boolean {
  return directText(el).length > 0;
}

function isScroller(ctx: ScanContext, el: Element): boolean {
  return /(?:auto|scroll)/.test(styleValue(ctx, el, 'overflow-x'))
    || /(?:auto|scroll)/.test(styleValue(ctx, el, 'overflow'));
}

function borderSideCount(ctx: ScanContext, el: Element, requireOpaqueColor = false, minimumWidth = 0): number {
  return ['top', 'right', 'bottom', 'left'].filter((side) => {
    const width = parsePx(styleValue(ctx, el, `border-${side}-width`)) ?? 0;
    if (width <= 0 || width < minimumWidth) return false;
    if (!requireOpaqueColor) return true;
    const color = parseColor(styleValue(ctx, el, `border-${side}-color`));
    return (color?.a ?? 0) > OCCLUSION_MIN_BORDER_ALPHA;
  }).length;
}

function isOpaqueDecoratedBox(ctx: ScanContext, el: Element): boolean {
  const background = parseColor(styleValue(ctx, el, 'background-color'));
  if ((background?.a ?? 0) > OCCLUSION_MIN_BACKGROUND_ALPHA) return true;
  return borderSideCount(ctx, el, true) >= 2;
}

function isLayered(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current && current !== ctx.doc.body) {
    const position = styleValue(ctx, current, 'position').toLowerCase() || 'static';
    if (position === 'absolute' || position === 'fixed' || position === 'sticky') return true;
    current = current.parentElement;
  }
  return false;
}

function isFloated(ctx: ScanContext, el: Element): boolean {
  const value = styleValue(ctx, el, 'float').toLowerCase();
  return value === 'left' || value === 'right';
}

function isMarqueeish(ctx: ScanContext, el: Element): boolean {
  if (el.tagName.toLowerCase() === 'marquee') return true;
  const identifier = `${el.getAttribute('class') ?? ''} ${el.id}`;
  if (/\b(?:marquee|ticker|scroller|carousel|conveyor)\b/i.test(identifier)) return true;
  return /marquee|ticker|scroll/.test(styleValue(ctx, el, 'animation-name'));
}

function isPinnedOverlay(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current && current !== ctx.doc.body) {
    const position = styleValue(ctx, current, 'position').toLowerCase() || 'static';
    if (position === 'fixed' || position === 'sticky') return true;
    current = current.parentElement;
  }
  return false;
}

function resolveLengthPx(value: string, fontSizePx: number): number | undefined {
  if (value === '' || value === 'normal' || value === 'auto' || value === 'inherit') return undefined;
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return undefined;
  if (value.endsWith('px')) return num;
  if (value.endsWith('rem')) return num * SR_ONLY_ROOT_FONT_SIZE_PX;
  if (value.endsWith('em')) return num * fontSizePx;
  if (value.endsWith('%')) return (num / 100) * fontSizePx;
  return num * fontSizePx;
}

function expandBoxShorthand(parts: string[]): string[] {
  switch (parts.length) {
    case 0: return [];
    case 1: return [parts[0]!, parts[0]!, parts[0]!, parts[0]!];
    case 2: return [parts[0]!, parts[1]!, parts[0]!, parts[1]!];
    case 3: return [parts[0]!, parts[1]!, parts[2]!, parts[1]!];
    default: return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
  }
}

function clippedByInset(clipPath: string | undefined): boolean {
  const value = (clipPath ?? '').trim().toLowerCase();
  const match = /^inset\s*\(([^)]*)\)$/.exec(value);
  if (!match) return false;
  const beforeRound = (match[1]?.split(/\s+round\s+/)[0] ?? '').trim();
  if (beforeRound === '') return false;
  const parts = beforeRound.split(/\s+/).slice(0, 4);
  const nums: number[] = [];
  for (const part of expandBoxShorthand(parts)) {
    const percent = /^(-?[0-9]+(?:\.[0-9]+)?)%$/.exec(part.trim());
    if (!percent) return false;
    nums.push(Number.parseFloat(percent[1]!));
  }
  if (nums.length < 4) return false;
  const top = nums[0];
  const right = nums[1];
  const bottom = nums[2];
  const left = nums[3];
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) return false;
  return top + bottom >= SR_ONLY_FULL_CLIP_PERCENT || left + right >= SR_ONLY_FULL_CLIP_PERCENT;
}

function clippedByRect(clip: string | undefined): boolean {
  const value = (clip ?? '').trim().toLowerCase();
  const match = /^rect\s*\(([^)]*)\)$/.exec(value);
  if (!match) return false;
  const values = (match[1] ?? '').split(/[\s,]+/).map((part) => part.trim()).filter((part) => part !== '');
  if (values.length !== 4) return false;
  const nums: number[] = [];
  for (const part of values) {
    const resolved = resolveLengthPx(part, SR_ONLY_DEFAULT_FONT_SIZE_PX);
    if (resolved === undefined) return false;
    nums.push(resolved);
  }
  const top = nums[0];
  const right = nums[1];
  const bottom = nums[2];
  const left = nums[3];
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) return false;
  return bottom <= top || right <= left;
}

function isScreenReaderOnly(ctx: ScanContext, el: Element): boolean {
  const clipsOverflow = ['overflow', 'overflow-x', 'overflow-y'].some((property) => {
    const value = styleValue(ctx, el, property).toLowerCase();
    return value === 'hidden' || value === 'clip';
  });
  const fontSize = resolveLengthPx(styleValue(ctx, el, 'font-size'), SR_ONLY_DEFAULT_FONT_SIZE_PX);
  const resolvedFontSize = fontSize !== undefined && fontSize !== 0 ? fontSize : SR_ONLY_DEFAULT_FONT_SIZE_PX;
  const rect = el.getBoundingClientRect();
  const metricLength = (values: number[]): number | undefined => {
    for (const value of values) {
      if (Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const width = metricLength([rect.width, el.clientWidth])
    ?? resolveLengthPx(styleValue(ctx, el, 'width'), resolvedFontSize)
    ?? resolveLengthPx(styleValue(ctx, el, 'inline-size'), resolvedFontSize);
  const height = metricLength([rect.height, el.clientHeight])
    ?? resolveLengthPx(styleValue(ctx, el, 'height'), resolvedFontSize)
    ?? resolveLengthPx(styleValue(ctx, el, 'block-size'), resolvedFontSize);
  const isTiny = width !== undefined && height !== undefined
    && width <= SR_ONLY_MAX_TINY_PX && height <= SR_ONLY_MAX_TINY_PX;
  const isAbsolutelyHidden = styleValue(ctx, el, 'position').toLowerCase() === 'absolute'
    && isTiny && clipsOverflow;
  const clipPathRaw = styleValue(ctx, el, 'clip-path');
  const clipPath = (clipPathRaw !== '' ? clipPathRaw : styleValue(ctx, el, '-webkit-clip-path')).trim();
  const clip = styleValue(ctx, el, 'clip').trim();
  return isAbsolutelyHidden || clippedByInset(clipPath) || clippedByRect(clip);
}

function paintedRect(ctx: ScanContext, el: Element, rect: DOMRect): DOMRect | undefined {
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;
  let current = el.parentElement;
  while (current && current !== ctx.doc.documentElement) {
    const overflowX = styleValue(ctx, current, 'overflow-x') || 'visible';
    const overflowY = styleValue(ctx, current, 'overflow-y') || 'visible';
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      const clipRect = current.getBoundingClientRect();
      if (overflowX !== 'visible') {
        left = Math.max(left, clipRect.left);
        right = Math.min(right, clipRect.right);
      }
      if (overflowY !== 'visible') {
        top = Math.max(top, clipRect.top);
        bottom = Math.min(bottom, clipRect.bottom);
      }
      if (right - left < 1 || bottom - top < 1) return undefined;
    }
    current = current.parentElement;
  }
  return left === rect.left && top === rect.top && right === rect.right && bottom === rect.bottom
    ? rect
    : {
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    } as DOMRect;
}

async function edgeFlushCards(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const findings: PageHit[] = [];
  const viewportHeight = ctx.innerHeight || 800;
  const scrollY = ctx.scrollY || 0;
  for (const scroller of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    if (!isScroller(ctx, scroller)) continue;
    // A snap rail start-aligns its first card by design.
    const snap = styleValue(ctx, scroller, 'scroll-snap-type');
    if (snap && snap !== 'none') continue;
    if (scroller.scrollWidth <= scroller.clientWidth + EDGE_SCROLL_EXTRA_PX) continue;
    if (scroller.scrollLeft > EDGE_SCROLL_LEFT_MAX_PX) continue;
    const scrollerRect = scroller.getBoundingClientRect();
    if (scrollerRect.width < EDGE_MIN_WIDTH_PX || scrollerRect.height < EDGE_MIN_HEIGHT_PX) continue;
    if (scrollerRect.top + scrollY > EDGE_TOP_VIEWPORT_MULTIPLIER * viewportHeight) continue;

    const contentLeft = scrollerRect.left + scroller.clientLeft;
    const contentRight = contentLeft + scroller.clientWidth;
    const flush: Array<{ card: Element; edge: 'left' | 'right'; gap: number }> = [];
    for (const card of Array.from(scroller.querySelectorAll('*'))) {
      await checkpoint();
      if (!isRendered(ctx, card)) continue;
      let owner = card.parentElement;
      while (owner && owner !== scroller && !isScroller(ctx, owner)) owner = owner.parentElement;
      if (owner !== scroller) continue;
      const cardRect = card.getBoundingClientRect();
      if (cardRect.width < EDGE_MIN_CARD_WIDTH_PX || cardRect.height < EDGE_MIN_CARD_HEIGHT_PX) continue;
      const background = parseColor(styleValue(ctx, card, 'background-color'));
      const hasBackground = (background?.a ?? 0) > EDGE_MIN_BACKGROUND_ALPHA;
      if (!hasBackground && borderSideCount(ctx, card) < EDGE_MIN_BORDER_SIDES) continue;
      const leftGutter = cardRect.left - contentLeft;
      const rightGap = contentRight - cardRect.right;
      const flushRight = leftGutter >= EDGE_MIN_GUTTER_PX
        && rightGap < EDGE_FLUSH_GAP_PX
        && rightGap > EDGE_MAX_NEGATIVE_GAP_PX;
      const flushLeft = rightGap >= EDGE_MIN_GUTTER_PX
        && leftGutter < EDGE_FLUSH_GAP_PX
        && leftGutter > EDGE_MAX_NEGATIVE_GAP_PX;
      if (flushRight || flushLeft) {
        flush.push({
          card,
          edge: flushRight ? 'right' : 'left',
          gap: roundValue(flushRight ? rightGap : leftGutter),
        });
      }
    }
    if (flush.length === 0) continue;
    const worst = flush.reduce((current, candidate) => candidate.gap < current.gap ? candidate : current);
    findings.push({
      el: scroller,
      detail: `${flush.length} card${flush.length === 1 ? '' : 's'} flush against the ${worst.edge} edge of ${classSelector(scroller)} at rest (${worst.gap}px gap, e.g. ${classSelector(worst.card)})`,
    });
  }
  return findings;
}

async function textElementsForOcclusion(ctx: ScanContext, checkpoint: Checkpoint): Promise<Array<{ el: Element; rect: DOMRect; text: string }>> {
  const textElements: Array<{ el: Element; rect: DOMRect; text: string }> = [];
  for (const el of Array.from(ctx.doc.querySelectorAll('body *'))) {
    await checkpoint();
    if (OCCLUSION_TEXT_SKIP_TAGS.has(el.tagName.toLowerCase())) continue;
    const inSvg = el.closest('svg') !== null;
    if (inSvg && el.tagName.toLowerCase() !== 'text') continue;
    const text = (inSvg ? el.textContent : directText(el))?.trim() ?? '';
    if (text.length < OCCLUSION_MIN_TEXT_LENGTH) continue;
    if (!isPaintedForOcclusion(ctx, el) || effectiveOpacity(ctx, el) <= OCCLUSION_MIN_EFFECTIVE_OPACITY) continue;
    const fullRect = el.getBoundingClientRect();
    if (fullRect.width < OCCLUSION_MIN_RECT_WIDTH_PX || fullRect.height < OCCLUSION_MIN_RECT_HEIGHT_PX) continue;
    const rect = paintedRect(ctx, el, fullRect);
    if (!rect || rect.width < OCCLUSION_MIN_RECT_WIDTH_PX || rect.height < OCCLUSION_MIN_RECT_HEIGHT_PX) continue;
    if (rect.bottom <= 0 || rect.top >= ctx.innerHeight) continue;
    textElements.push({ el, rect, text });
  }
  return textElements;
}

async function occlusionVictims(ctx: ScanContext, checkpoint: Checkpoint): Promise<Array<{ el: Element; rect: DOMRect; text: string }>> {
  return (await textElementsForOcclusion(ctx, checkpoint)).filter((victim) => !isScreenReaderOnly(ctx, victim.el));
}

// Hit testing skips a pointer-events:none element, so its occlusion cannot be read off the page.
function isHitTestable(ctx: ScanContext, el: Element): boolean {
  return styleValue(ctx, el, 'pointer-events') !== 'none';
}

// The topmost element painted above the victim at the point that is not its descendant or
// ancestor, or undefined when the victim is not hit there or nothing else is above it.
function occluderAt(ctx: ScanContext, victim: Element, x: number, y: number): Element | undefined {
  const stack = ctx.doc.elementsFromPoint(x, y);
  const index = stack.findIndex((el) => victim.contains(el));
  if (index < 0) return undefined;
  return stack.slice(0, index).find((el) => !el.contains(victim));
}

async function textOcclusion(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const findings: PageHit[] = [];
  const seenVictims = new Set<Element>();
  const textElements = (await occlusionVictims(ctx, checkpoint)).filter((victim) => isHitTestable(ctx, victim.el));
  const viewportWidth = ctx.innerWidth || 1280;
  const viewportHeight = ctx.innerHeight || 800;

  for (const victim of textElements) {
    await checkpoint();
    if (seenVictims.has(victim.el)) continue;
    const cols = Math.max(OCCLUSION_MIN_GRID_COLUMNS, Math.min(OCCLUSION_MAX_GRID_COLUMNS, Math.round(victim.rect.width / OCCLUSION_GRID_COLUMN_DIVISOR)));
    const rows = Math.max(OCCLUSION_MIN_GRID_ROWS, Math.min(OCCLUSION_MAX_GRID_ROWS, Math.round(victim.rect.height / OCCLUSION_GRID_ROW_DIVISOR)));
    let total = 0;
    let occluded = 0;
    let occluder: Element | undefined;
    let occluderKind: 'box' | 'text' | undefined;
    for (let column = 0; column < cols; column += 1) {
      const x = victim.rect.left + victim.rect.width * ((column + 0.5) / cols);
      if (x < OCCLUSION_EDGE_SAMPLE_PX || x > viewportWidth - OCCLUSION_EDGE_SAMPLE_PX) continue;
      for (let row = 0; row < rows; row += 1) {
        const y = victim.rect.top + victim.rect.height * ((row + 0.5) / rows);
        if (y < OCCLUSION_EDGE_SAMPLE_PX || y > viewportHeight - OCCLUSION_EDGE_SAMPLE_PX) continue;
        total += 1;
        const top = occluderAt(ctx, victim.el, x, y);
        if (!top) continue;
        if (isFloated(ctx, top) || isMarqueeish(ctx, top) || isPinnedOverlay(ctx, top) || effectiveOpacity(ctx, top) <= OCCLUSION_MIN_EFFECTIVE_OPACITY) continue;
        const tag = top.tagName.toLowerCase();
        if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture') continue;
        const topHasText = directText(top).length > 0 || top.closest('svg') !== null;
        if (isOpaqueDecoratedBox(ctx, top)) {
          occluded += 1;
          occluder ??= top;
          occluderKind ??= 'box';
        } else if (topHasText) {
          occluded += 1;
          occluder ??= top;
          occluderKind ??= 'text';
        }
      }
    }
    if (!occluder || total === 0) continue;
    const fraction = occluded / total;
    const minimum = occluderKind === 'text' ? OCCLUSION_TEXT_FRACTION : OCCLUSION_BOX_FRACTION;
    if (fraction < minimum) continue;
    if (occluderKind === 'text') {
      const victimSvg = victim.el.closest('svg');
      const occluderSvg = occluder.closest('svg');
      if (victimSvg !== null && occluderSvg !== null && victimSvg === occluderSvg) continue;
      if (!isLayered(ctx, victim.el) && !isLayered(ctx, occluder)) continue;
    }
    seenVictims.add(victim.el);
    findings.push({
      el: victim.el,
      detail: `${classSelector(victim.el)} "${victim.text.slice(0, 24)}" is ${roundValue(fraction * 100)}% covered by ${occluderKind === 'text' ? 'overlapping text' : 'an opaque element'} (${classSelector(occluder)})`,
    });
  }

  const cards: Array<{ el: Element; rect: DOMRect }> = [];
  for (const el of Array.from(ctx.doc.querySelectorAll('body *'))) {
    await checkpoint();
    if (!isPaintedForOcclusion(ctx, el) || el.closest('svg') !== null) continue;
    const background = parseColor(styleValue(ctx, el, 'background-color'));
    if ((background?.a ?? 0) <= 0.7) continue;
    const backgroundImage = styleValue(ctx, el, 'background-image');
    if (backgroundImage && backgroundImage !== 'none' && /(gradient|url)\(/i.test(backgroundImage)) continue;
    const boxShadow = styleValue(ctx, el, 'box-shadow');
    const hasShadow = boxShadow !== '' && boxShadow !== 'none';
    if (borderSideCount(ctx, el) === 0 && !hasShadow) continue;
    if (isPinnedOverlay(ctx, el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < OCCLUSION_CARD_MIN_WIDTH_PX || rect.width > OCCLUSION_CARD_MAX_WIDTH_VIEWPORT_RATIO * viewportWidth || rect.height < OCCLUSION_CARD_MIN_HEIGHT_PX) continue;
    cards.push({ el, rect });
  }
  for (const victim of textElements) {
    await checkpoint();
    if (seenVictims.has(victim.el)) continue;
    const fontSize = numberValue(styleValue(ctx, victim.el, 'font-size'), 16);
    if (fontSize < OCCLUSION_HEADLINE_FONT_SIZE_PX) continue;
    const lineHeight = numberValue(styleValue(ctx, victim.el, 'line-height'), fontSize * 1.2);
    const centerX = victim.rect.left + victim.rect.width / 2;
    for (const card of cards) {
      await checkpoint();
      if (card.el === victim.el || victim.el.contains(card.el) || card.el.contains(victim.el)) continue;
      const intersectionWidth = Math.max(0, Math.min(victim.rect.right, card.rect.right) - Math.max(victim.rect.left, card.rect.left));
      const intersectionHeight = Math.max(0, Math.min(victim.rect.bottom, card.rect.bottom) - Math.max(victim.rect.top, card.rect.top));
      if (intersectionWidth < OCCLUSION_HEADLINE_MIN_INTERSECTION_PX || intersectionHeight < OCCLUSION_HEADLINE_LINE_INTERSECTION_RATIO * lineHeight) continue;
      if (centerX >= card.rect.left && centerX <= card.rect.right) continue;
      if (intersectionWidth > OCCLUSION_HEADLINE_MAX_INTERSECTION_RATIO * victim.rect.width) continue;
      seenVictims.add(victim.el);
      findings.push({
        el: victim.el,
        detail: `${classSelector(victim.el)} "${victim.text.slice(0, 24)}" overhangs ${classSelector(card.el)} by ${roundValue(intersectionWidth)}px — the headline and the card collide`,
      });
      break;
    }
  }

  for (const el of Array.from(ctx.doc.querySelectorAll('body *'))) {
    await checkpoint();
    if (seenVictims.has(el) || el.closest('svg') !== null || !isPaintedForOcclusion(ctx, el)) continue;
    if (styleValue(ctx, el, 'display') !== 'inline') continue;
    const background = parseColor(styleValue(ctx, el, 'background-color'));
    if ((background?.a ?? 0) <= 0.6) continue;
    const paddingTop = parsePx(styleValue(ctx, el, 'padding-top')) ?? 0;
    const paddingBottom = parsePx(styleValue(ctx, el, 'padding-bottom')) ?? 0;
    if (paddingTop + paddingBottom < OCCLUSION_INLINE_MIN_VERTICAL_PADDING_PX) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < OCCLUSION_INLINE_MIN_WIDTH_PX || rect.height < OCCLUSION_INLINE_MIN_HEIGHT_PX) continue;
    const fontSize = numberValue(styleValue(ctx, el, 'font-size'), 16);
    const lineHeight = numberValue(styleValue(ctx, el, 'line-height'), fontSize * 1.4);
    if (rect.height < OCCLUSION_INLINE_HEIGHT_LINE_RATIO * lineHeight) continue;
    let overlap: Element | undefined;
    for (const sibling of Array.from(el.parentElement?.children ?? [])) {
      if (sibling === el) continue;
      if (styleValue(ctx, sibling, 'display') === 'none') continue;
      const siblingRect = sibling.getBoundingClientRect();
      const intersectionWidth = Math.max(0, Math.min(rect.right, siblingRect.right) - Math.max(rect.left, siblingRect.left));
      const intersectionHeight = Math.max(0, Math.min(rect.bottom, siblingRect.bottom) - Math.max(rect.top, siblingRect.top));
      if (intersectionWidth > OCCLUSION_INLINE_SIBLING_INTERSECTION_PX && intersectionHeight > OCCLUSION_INLINE_SIBLING_INTERSECTION_PX && sibling.textContent?.trim()) {
        overlap = sibling;
        break;
      }
    }
    seenVictims.add(el);
    findings.push({
      el,
      detail: `${classSelector(el)} is an inline element whose opaque fill leaks ${roundValue(rect.height)}px past its line${overlap ? ` onto ${classSelector(overlap)}` : ''}`,
    });
  }
  return findings;
}

async function firstViewportColumnOverflow(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const findings: PageHit[] = [];
  const viewportWidth = ctx.innerWidth || 1280;
  const viewportHeight = ctx.innerHeight || 800;
  for (const section of Array.from(ctx.doc.querySelectorAll('body *'))) {
    await checkpoint();
    const display = styleValue(ctx, section, 'display');
    if (!/(?:^|inline-)(?:grid|flex)$/.test(display)) continue;
    const sectionRect = section.getBoundingClientRect();
    if (sectionRect.width < FIRST_VIEWPORT_SECTION_MIN_WIDTH_RATIO * viewportWidth) continue;
    const pageTop = sectionRect.top + ctx.scrollY;
    const pageBottom = pageTop + sectionRect.height;
    if (pageTop >= FIRST_VIEWPORT_SECTION_TOP_RATIO * viewportHeight || pageBottom <= viewportHeight) continue;
    // A page shell holding main is the site layout, not an opening section.
    if (section.querySelector('main') !== null) continue;
    const columns: Array<{ el: Element; top: number; contentHeight: number }> = [];
    for (const child of Array.from(section.children)) {
      if (styleValue(ctx, child, 'display') === 'none') continue;
      const position = styleValue(ctx, child, 'position');
      if (position === 'absolute' || position === 'fixed') continue;
      const childRect = child.getBoundingClientRect();
      const widthShare = childRect.width / sectionRect.width;
      if (widthShare < FIRST_VIEWPORT_COLUMN_MIN_WIDTH_RATIO || widthShare > FIRST_VIEWPORT_COLUMN_MAX_WIDTH_RATIO) continue;
      if (childRect.height < FIRST_VIEWPORT_COLUMN_MIN_HEIGHT_PX) continue;
      let contentBottom = childRect.top;
      for (const descendant of Array.from(child.querySelectorAll('*'))) {
        await checkpoint();
        const descendantPosition = styleValue(ctx, descendant, 'position');
        if (descendantPosition === 'absolute' || descendantPosition === 'fixed') continue;
        if (styleValue(ctx, descendant, 'display') === 'none' || styleValue(ctx, descendant, 'visibility') === 'hidden') continue;
        const descendantRect = descendant.getBoundingClientRect();
        if (descendantRect.width > 0 && descendantRect.height > 0) contentBottom = Math.max(contentBottom, descendantRect.bottom);
      }
      columns.push({ el: child, top: childRect.top, contentHeight: contentBottom - childRect.top });
    }
    if (columns.length < 2) continue;
    columns.sort((a, b) => b.contentHeight - a.contentHeight);
    const tall = columns[0]!;
    const shortest = columns[columns.length - 1]!;
    if (Math.abs(tall.top - shortest.top) > FIRST_VIEWPORT_COLUMNS_MAX_TOP_DELTA_RATIO * viewportHeight) continue;
    if (tall.contentHeight <= FIRST_VIEWPORT_TALL_HEIGHT_RATIO * viewportHeight) continue;
    if (shortest.contentHeight > FIRST_VIEWPORT_SHORT_HEIGHT_RATIO * viewportHeight) continue;
    // A navigation or complementary sidebar is expected to end long before the content.
    if (shortest.el.closest(FIRST_VIEWPORT_SIDEBAR_SELECTOR) !== null) continue;
    findings.push({
      el: section,
      detail: `${classSelector(section)} opens the page with one column running ${roundValue(tall.contentHeight / viewportHeight * 100)}% of the viewport tall while a sibling fits in ${roundValue(shortest.contentHeight / viewportHeight * 100)}% — the fold falls deep inside the section`,
    });
  }
  return findings;
}

function textOverflow(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  if (TEXT_OVERFLOW_SKIP_TAGS.has(tag) || el.namespaceURI === 'http://www.w3.org/2000/svg') return [];
  if (!isRendered(ctx, el) || !hasDirectText(el) || isScreenReaderOnly(ctx, el)) return [];
  const clipsX = (value: string): boolean => value === 'hidden' || value === 'clip';
  if (styleValue(ctx, el, 'text-overflow') === 'ellipsis'
    && (clipsX(styleValue(ctx, el, 'overflow-x')) || clipsX(styleValue(ctx, el, 'overflow')))) return [];
  let ancestor = el.parentElement;
  while (ancestor) {
    if (isScroller(ctx, ancestor)) return [];
    ancestor = ancestor.parentElement;
  }
  const clientWidth = el.clientWidth;
  const delta = el.scrollWidth - clientWidth;
  if (clientWidth > 0 && delta >= TEXT_OVERFLOW_MIN_DELTA_PX) {
    return [{ detail: `${classSelector(el)} overflows its box by ${roundValue(delta)}px` }];
  }
  if (clientWidth !== 0 || el.getBoundingClientRect().width <= 0) return [];
  let container = el.parentElement;
  while (container && container.clientWidth === 0) container = container.parentElement;
  if (!container) return [];
  const stop = container.parentElement;
  let current: Element | null = el;
  while (current && current !== stop) {
    const transform = styleValue(ctx, current, 'transform');
    if (transform && transform !== 'none') return [];
    current = current.parentElement;
  }
  const containerRect = container.getBoundingClientRect();
  const contentRight = containerRect.left + container.clientLeft + container.clientWidth;
  const spill = el.getBoundingClientRect().right - contentRight;
  return spill >= TEXT_OVERFLOW_MIN_DELTA_PX
    ? [{ detail: `${classSelector(el)} overflows its container by ${roundValue(spill)}px` }]
    : [];
}

function cleanInlineText(el: Element): string {
  return directText(el);
}

function isRepeatedTextContainer(ctx: ScanContext, el: Element): boolean {
  const hasShadow = styleValue(ctx, el, 'box-shadow') !== '' && styleValue(ctx, el, 'box-shadow') !== 'none';
  const hasBorder = borderSideCount(ctx, el, false, REPEATED_TEXT_MIN_BORDER_WIDTH_PX) >= REPEATED_TEXT_MIN_BORDER_SIDES;
  const radius = parsePx(styleValue(ctx, el, 'border-radius')) ?? 0;
  const hasRadius = radius > 0;
  const background = parseColor(styleValue(ctx, el, 'background-color'));
  const hasBackground = (background?.a ?? 0) > REPEATED_TEXT_MIN_BACKGROUND_ALPHA;
  return (hasShadow || hasBorder) && (hasRadius || hasBackground);
}

async function repeatedContainerText(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const findings: PageHit[] = [];
  const containers: Element[] = [];
  for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    if (REPEATED_TEXT_CONTAINER_TAGS.has(el.tagName.toLowerCase())
      && !el.closest(REPEATED_TEXT_SKIP_SELECTOR)
      && isRepeatedTextContainer(ctx, el)) containers.push(el);
  }

  for (const container of containers) {
    await checkpoint();
    if (!isRendered(ctx, container)) continue;
    const descendants = Array.from(container.querySelectorAll('*'));
    if (descendants.length > REPEATED_TEXT_MAX_DESCENDANTS) continue;
    const groups = new Map<string, string[]>();
    for (const descendant of descendants) {
      await checkpoint();
      let ancestor = descendant.parentElement;
      let ownedByInner = false;
      while (ancestor && ancestor !== container) {
        if (containers.includes(ancestor)) {
          ownedByInner = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (ownedByInner || descendant.closest(REPEATED_TEXT_SKIP_SELECTOR)) continue;
      if (/icon|material-symbols|(?:^|\s)fa[srlbd]?(?:\s|-|$)/i.test(descendant.getAttribute('class') ?? '')) continue;
      if (!isRendered(ctx, descendant)) continue;
      const text = cleanInlineText(descendant);
      if (text.length < REPEATED_TEXT_MIN_LENGTH || text.length > REPEATED_TEXT_MAX_LENGTH || !/[a-z]/i.test(text)) continue;
      const signatureParts: string[] = [];
      let current: Element | null = descendant;
      while (current && current !== container) {
        const classes = [...current.classList].sort().join('.');
        signatureParts.push(classes ? `${current.tagName.toLowerCase()}.${classes}` : current.tagName.toLowerCase());
        current = current.parentElement;
      }
      const signature = signatureParts.join('>');
      const signatures = groups.get(text) ?? [];
      signatures.push(signature);
      groups.set(text, signatures);
    }
    for (const [text, signatures] of groups) {
      const distinct = new Set(signatures);
      if (signatures.length < REPEATED_TEXT_MIN_OCCURRENCES || distinct.size < REPEATED_TEXT_MIN_DISTINCT_SIGNATURES) continue;
      findings.push({
        el: container,
        detail: `"${text.slice(0, 40)}" rendered ${signatures.length}× in distinct spots inside ${classSelector(container)}`,
      });
    }
  }
  return findings;
}

function positionedChildHasSubstantiveContent(child: Element): boolean {
  return child.textContent?.replace(/\s+/g, ' ').trim() !== '' || child.matches(INTERACTIVE_SELECTOR) || child.querySelector(INTERACTIVE_SELECTOR) !== null;
}

function positionedChildIsDecorative(child: Element): boolean {
  if (child.closest('[aria-hidden="true"]') !== null) return true;
  const role = (child.getAttribute('role') ?? '').toLowerCase();
  if (role === 'none' || role === 'presentation') return true;
  if (new Set(['img', 'svg', 'canvas', 'video']).has(child.tagName.toLowerCase())) return true;
  const identifier = `${child.getAttribute('class') ?? ''} ${child.id}`;
  return DECORATIVE_IDENTIFIER_RE.test(identifier) && !positionedChildHasSubstantiveContent(child);
}

function isIntentionalViewport(el: Element): boolean {
  const roleDescription = (el.getAttribute('aria-roledescription') ?? '').toLowerCase();
  if (CAROUSEL_ROLE_RE.test(roleDescription)) return true;
  const identifier = `${el.getAttribute('class') ?? ''} ${el.id}`.toLowerCase();
  return VIEWPORT_IDENTIFIER_RE.test(identifier) || DEMO_IDENTIFIER_RE.test(identifier);
}

function positionedStyleImpliesEscape(ctx: ScanContext, el: Element): boolean {
  const properties = [
    'top',
    'right',
    'bottom',
    'left',
    'inset',
    'inset-block',
    'inset-inline',
    'inset-block-start',
    'inset-block-end',
    'inset-inline-start',
    'inset-inline-end',
  ];
  return properties.some((property) => {
    const value = styleValue(ctx, el, property).toLowerCase();
    return /(?:^|[\s(])-+(?:\d|\.)/.test(value) || /(?:^|[\s(])100(?:\.0+)?%/.test(value);
  });
}

function clippedOverflowContainer(el: Element, ctx: ScanContext): RuleHit[] {
  const clip = (value: string): boolean => value === 'hidden' || value === 'clip';
  const scroll = (value: string): boolean => value === 'auto' || value === 'scroll';
  const overflowX = styleValue(ctx, el, 'overflow-x');
  const overflowY = styleValue(ctx, el, 'overflow-y');
  const overflow = styleValue(ctx, el, 'overflow');
  const clipX = clip(overflowX) || clip(overflow);
  const clipY = clip(overflowY) || clip(overflow);
  const anyClip = clipX || clipY;
  const anyScroll = scroll(overflowX) || scroll(overflowY) || scroll(overflow);
  if (!anyClip || anyScroll || isIntentionalViewport(el)) return [];
  const parentRect = el.getBoundingClientRect();
  const rectUsable = (rect: DOMRect): boolean =>
    [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)
    && !(rect.width <= 0 && rect.height <= 0);
  for (const child of Array.from(el.querySelectorAll('*'))) {
    const position = styleValue(ctx, child, 'position');
    if (position !== 'absolute' && position !== 'fixed') continue;
    if (positionedChildIsDecorative(child)) continue;
    const childRect = child.getBoundingClientRect();
    const hasGeometry = rectUsable(parentRect) && rectUsable(childRect);
    const escapes = hasGeometry && ((clipX && (childRect.left < parentRect.left - CLIP_ESCAPE_THRESHOLD_PX || childRect.right > parentRect.right + CLIP_ESCAPE_THRESHOLD_PX))
      || (clipY && (childRect.top < parentRect.top - CLIP_ESCAPE_THRESHOLD_PX || childRect.bottom > parentRect.bottom + CLIP_ESCAPE_THRESHOLD_PX)));
    if (hasGeometry ? !escapes : !positionedStyleImpliesEscape(ctx, child)) continue;
    return [{ detail: `${classSelector(el)} clips a positioned child` }];
  }
  return [];
}

async function textOcclusionUnchecked(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const count = (await occlusionVictims(ctx, checkpoint)).filter((victim) => !isHitTestable(ctx, victim.el)).length;
  if (count === 0) return [];
  return [{ detail: `${count} text element${count === 1 ? '' : 's'} with pointer-events:none ${count === 1 ? 'was' : 'were'} not checked for occlusion` }];
}

const edgeFlushCardsRule: PageRule = {
  id: 'edge-flush-cards',
  category: 'quality',
  name: 'Cards flush against the scroller edge',
  description: 'Cards inside a horizontal scroller or tab panel sit flush against the container edge at rest while keeping a gutter on the other side, so their edges and rounded corners get cut off. Usually the panel is sized wider than its clip box. Keep a consistent inset on both sides.',
  scope: 'page',
  test: edgeFlushCards,
};

const textOcclusionRule: PageRule = {
  id: 'text-occlusion',
  category: 'quality',
  name: 'Text occluded by an overlapping element',
  description: 'Text is painted under an opaque element or a second text run, so part of it cannot be read. A decorative box, a stacked layer, or an inline element with leaked padding lands on the words instead of beside them. Give overlapping layers room, or move the text out from under the layer above it.',
  scope: 'page',
  test: textOcclusion,
};

const textOcclusionUncheckedRule: PageRule = {
  id: 'text-occlusion-unchecked',
  category: 'quality',
  severity: 'advisory',
  name: 'Text not checked for occlusion',
  description: 'Text with pointer-events:none is skipped by hit testing, so the scan cannot tell whether another element paints over it. Floating form labels are the usual case. Check these by eye.',
  scope: 'page',
  test: textOcclusionUnchecked,
};

const firstViewportColumnOverflowRule: PageRule = {
  id: 'first-viewport-column-overflow',
  category: 'quality',
  name: 'One column stretches the first viewport',
  description: 'A multi-column opening section lets one column run far past the fold while its sibling fits in a single viewport, so the short column floats in dead space and the fold falls deep inside one section. Balance the columns, cap the tall one, or let the long content flow below the opening row.',
  scope: 'page',
  test: firstViewportColumnOverflow,
};

const textOverflowRule: ElementRule = {
  id: 'text-overflow',
  category: 'quality',
  name: 'Content overflowing its container',
  description: 'Content renders wider than its container, spilling out or forcing a horizontal scrollbar. Let text wrap, constrain widths, or give the region a deliberate scroll affordance.',
  scope: 'element',
  test: textOverflow,
};

const repeatedContainerTextRule: PageRule = {
  id: 'repeated-container-text',
  category: 'quality',
  name: 'Same text repeated inside one container',
  description: 'The same literal text rendered three or more times in structurally different spots inside a single card or panel is redundant messaging — usually a status or label wired into every slot of a template. Say it once, in the slot where it matters most.',
  scope: 'page',
  test: repeatedContainerText,
};

const clippedOverflowContainerRule: ElementRule = {
  id: 'clipped-overflow-container',
  category: 'quality',
  name: 'Positioned child clipped by overflow container',
  description: 'A clipping container (overflow hidden or clip) wrapping an absolutely-positioned child cuts off tooltips, menus, and popovers that need to escape. Let the overflow be visible, or move the positioned layer out of the clip.',
  scope: 'element',
  test: clippedOverflowContainer,
};

export const liveStateRules: Rule[] = [
  edgeFlushCardsRule,
  textOcclusionRule,
  textOcclusionUncheckedRule,
  firstViewportColumnOverflowRule,
  textOverflowRule,
  repeatedContainerTextRule,
  clippedOverflowContainerRule,
];
