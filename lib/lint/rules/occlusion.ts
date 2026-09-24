import { parseColor } from '../color';
import { parsePx } from '../css';
import type { Checkpoint, PageHit, PageRule, Rule, ScanContext } from '../engine';
import { classSelector, styleValue } from '../dom';

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
const OCCLUSION_TEXT_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'title']);

export function numberValue(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundValue(value: number): number {
  return Math.round(value);
}

export function directText(el: Element): string {
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

export function borderSideCount(ctx: ScanContext, el: Element, requireOpaqueColor = false, minimumWidth = 0): number {
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

export function isScreenReaderOnly(ctx: ScanContext, el: Element): boolean {
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

async function textOcclusionUnchecked(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const count = (await occlusionVictims(ctx, checkpoint)).filter((victim) => !isHitTestable(ctx, victim.el)).length;
  if (count === 0) return [];
  return [{ detail: `${count} text element${count === 1 ? '' : 's'} with pointer-events:none ${count === 1 ? 'was' : 'were'} not checked for occlusion` }];
}

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

export const occlusionRules: Rule[] = [textOcclusionRule, textOcclusionUncheckedRule];
