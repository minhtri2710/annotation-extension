import { parseColor } from '../color';
import { parsePx } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const DOT_MIN_SIZE_PX = 2;
const DOT_MAX_SIZE_PX = 16;
const DOT_MIN_ROUND_RADIUS_PERCENT = 40;
const DOT_MIN_ROUND_RADIUS_RATIO = 0.4;
const CURSOR_FIRST_VIEWPORT_PX = 1200;
const CURSOR_MIN_BACKGROUND_ALPHA = 0.2;
const CURSOR_MIN_BORDER_PX = 1;
const CURSOR_MAX_RADIUS_RATIO = 0.4;
const MARQUEE_MIN_TRAVEL_PERCENT = 20;
const REDUCE_MOTION_RE = /prefers-reduced-motion\s*:\s*reduce/i;
const NOT_REDUCE_MOTION_RE = /not\s*\(\s*prefers-reduced-motion\s*:\s*reduce/i;
const NO_PREFERENCE_MOTION_RE = /prefers-reduced-motion\s*:\s*no-preference/i;
const LAYOUT_TRANSITION_PROPS = new Set([
  'width',
  'height',
  'padding',
  'margin',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
]);
const SAFE_MOTION_TAGS = new Set([
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
  'label',
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

interface CssRuleWithChildren extends CSSRule {
  readonly cssRules?: CSSRuleList;
}

interface CssRuleWithName extends CssRuleWithChildren {
  readonly name?: string;
  readonly selectorText?: string;
  readonly style?: CSSStyleDeclaration;
}

interface KeyframeInfo {
  name: string;
  frames: CSSKeyframeRule[];
}

function styleValue(ctx: ScanContext, el: Element, property: string): string {
  return ctx.style(el).getPropertyValue(property).trim();
}

function splitCssList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function animationNames(ctx: ScanContext, el: Element): string[] {
  return splitCssList(styleValue(ctx, el, 'animation-name'))
    .filter((name) => name.toLowerCase() !== 'none');
}

function hasInfiniteAnimation(ctx: ScanContext, el: Element, name: string): boolean {
  const names = animationNames(ctx, el);
  const counts = splitCssList(styleValue(ctx, el, 'animation-iteration-count'));
  return names.some((candidate, index) => {
    if (candidate !== name) return false;
    const count = counts[index] ?? counts[counts.length - 1] ?? '';
    return count.toLowerCase() === 'infinite';
  });
}

function classSelector(el: Element): string {
  const tag = el.tagName.toLowerCase() || 'el';
  const classes = [...el.classList].filter(Boolean);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

function readableRules(sheet: CSSStyleSheet): CSSRuleList | undefined {
  try {
    return sheet.cssRules;
  } catch {
    return undefined;
  }
}

function childRules(rule: CssRuleWithChildren): CSSRuleList | undefined {
  try {
    return rule.cssRules;
  } catch {
    return undefined;
  }
}

function allRules(doc: Document): CSSRule[] {
  const result: CSSRule[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    const rules = readableRules(sheet);
    if (!rules) continue;
    const pending = Array.from(rules);
    while (pending.length > 0) {
      const rule = pending.shift()!;
      result.push(rule);
      const nested = childRules(rule);
      if (nested) pending.push(...Array.from(nested));
    }
  }
  return result;
}

interface MediaScopedRule {
  rule: CssRuleWithName;
  media: string;
}

function mediaScopedRules(doc: Document): MediaScopedRule[] {
  const result: MediaScopedRule[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    const rules = readableRules(sheet);
    if (!rules) continue;
    const pending = Array.from(rules, (rule) => ({ rule: rule as CssRuleWithName, media: sheet.media.mediaText }));
    while (pending.length > 0) {
      const scoped = pending.shift()!;
      result.push(scoped);
      const nested = childRules(scoped.rule);
      if (!nested) continue;
      const media = scoped.rule.type === 4 ? `${scoped.media} ${(scoped.rule as CSSMediaRule).media.mediaText}` : scoped.media;
      pending.push(...Array.from(nested, (rule) => ({ rule: rule as CssRuleWithName, media })));
    }
  }
  return result;
}

function matchesSelector(el: Element, selectorText: string): boolean {
  try {
    return el.matches(selectorText);
  } catch {
    return false;
  }
}

// A reduced-motion guard means a reduce rule switches the element's animation off, or every rule that sets it only applies under no-preference.
function reducedMotionGuarded(el: Element, ctx: ScanContext, name: string | undefined): boolean {
  const inline = (el as Partial<ElementCSSInlineStyle>).style?.getPropertyValue('animation-name') ?? '';
  if (name && splitCssList(inline).includes(name)) return false;
  let setters = 0;
  let unguardedSetter = false;
  for (const { rule, media } of mediaScopedRules(ctx.doc)) {
    if (rule.type !== 1 || !rule.style || !matchesSelector(el, rule.selectorText ?? '')) continue;
    const names = splitCssList(rule.style.getPropertyValue('animation-name'));
    const count = rule.style.getPropertyValue('animation-iteration-count').trim().toLowerCase();
    if (REDUCE_MOTION_RE.test(media) && !NOT_REDUCE_MOTION_RE.test(media)
      && (names.some((candidate) => candidate.toLowerCase() === 'none') || (count !== '' && count !== 'infinite'))) return true;
    if (!name || !names.includes(name)) continue;
    setters += 1;
    if (!NO_PREFERENCE_MOTION_RE.test(media) && !NOT_REDUCE_MOTION_RE.test(media)) unguardedSetter = true;
  }
  return setters > 0 && !unguardedSetter;
}

function keyframes(doc: Document, name: string): KeyframeInfo | undefined {
  if (!name) return undefined;
  for (const rule of allRules(doc)) {
    if (rule.type !== 7) continue;
    const candidate = rule as CssRuleWithName;
    if (candidate.name !== name) continue;
    const frames = childRules(candidate);
    if (!frames) return { name, frames: [] };
    return {
      name,
      frames: Array.from(frames).filter((frame): frame is CSSKeyframeRule => frame.type === 8),
    };
  }
  return undefined;
}

function declarations(frame: CSSKeyframeRule): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (let index = 0; index < frame.style.length; index += 1) {
    const property = frame.style.item(index);
    if (property) result.push([property, frame.style.getPropertyValue(property).trim()]);
  }
  return result;
}

function keyframeHasPulseBody(info: KeyframeInfo | undefined): boolean {
  if (!info) return false;
  return info.frames.some((frame) => declarations(frame).some(([property, value]) => (
    property === 'opacity'
      || property === 'box-shadow'
      || (property === 'transform' && /\bscale\s*\(/i.test(value))
  )));
}

function keyframeTogglesVisibility(info: KeyframeInfo | undefined): boolean {
  if (!info) return false;
  let togglesOut = false;
  for (const frame of info.frames) {
    for (const [property, value] of declarations(frame)) {
      if (property === 'opacity') {
        if ((Number.parseFloat(value) || 0) <= 0.15) togglesOut = true;
      } else if (property === 'visibility') {
        if (value.toLowerCase() === 'hidden') togglesOut = true;
      } else if (property !== 'animation-timing-function') {
        return false;
      }
    }
  }
  return togglesOut;
}

function parseOvershoot(value: string): string | undefined {
  const match = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/gi;
  for (const candidate of value.matchAll(match)) {
    const y1 = Number.parseFloat(candidate[2]!);
    const y2 = Number.parseFloat(candidate[4]!);
    if (y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1) return candidate[0];
  }
  return undefined;
}

function bounceEasingHit(el: Element, ctx: ScanContext): RuleHit[] {
  if (SAFE_MOTION_TAGS.has(el.tagName.toLowerCase())) return [];
  const animationName = styleValue(ctx, el, 'animation-name');
  if (animationName && animationName !== 'none' && /bounce|elastic|wobble|jiggle|spring/i.test(animationName)) {
    return [{ detail: `animation: ${animationName}` }];
  }
  if ([...el.classList].some((token) => token === 'animate-bounce')) {
    return [{ detail: 'animate-bounce (Tailwind)' }];
  }
  const timing = [
    styleValue(ctx, el, 'animation-timing-function'),
    styleValue(ctx, el, 'transition-timing-function'),
  ].filter(Boolean).join(' ');
  const overshoot = parseOvershoot(timing);
  return overshoot ? [{ detail: overshoot }] : [];
}

const TAILWIND_TINY_SIZES: Record<string, number> = {
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '3.5': 14,
  '4': 16,
};

function tailwindTinySize(el: Element, axis: 'w' | 'h'): number | undefined {
  for (const token of el.classList) {
    const match = new RegExp(`^(?:${axis}|size)-(1|1\\.5|2|2\\.5|3|3\\.5|4)$`).exec(token);
    if (match) return TAILWIND_TINY_SIZES[match[1]!];
  }
  return undefined;
}

function roundDot(radius: string, width: number, height: number, tailwindRounded = false): boolean {
  if (tailwindRounded) return true;
  const first = radius.trim().split(/\s+/)[0] ?? '';
  const percentage = /^(-?(?:\d+\.?\d*|\.\d+))%$/.exec(first);
  if (percentage && Number.parseFloat(percentage[1]!) >= DOT_MIN_ROUND_RADIUS_PERCENT) return true;
  const pixels = parsePx(first);
  return pixels !== undefined
    && (pixels >= 999 || pixels >= DOT_MIN_ROUND_RADIUS_RATIO * Math.min(width, height));
}

function pulsingDotHit(el: Element, ctx: ScanContext): RuleHit[] {
  const tailwindPulse = [...el.classList].find((token) => token === 'animate-pulse' || token === 'animate-ping');
  const tailwindRounded = el.classList.contains('rounded-full');
  const width = parsePx(styleValue(ctx, el, 'width')) ?? tailwindTinySize(el, 'w');
  const height = parsePx(styleValue(ctx, el, 'height')) ?? tailwindTinySize(el, 'h');
  if (
    width === undefined
    || height === undefined
    || width < DOT_MIN_SIZE_PX
    || height < DOT_MIN_SIZE_PX
    || width > DOT_MAX_SIZE_PX
    || height > DOT_MAX_SIZE_PX
    || !roundDot(styleValue(ctx, el, 'border-radius'), width, height, tailwindRounded)
  ) return [];

  const name = animationNames(ctx, el).find((candidate) => (
    hasInfiniteAnimation(ctx, el, candidate)
    && (/pulse|blink|ping/i.test(candidate) || keyframeHasPulseBody(keyframes(ctx.doc, candidate)))
  ));
  if (!name && !tailwindPulse) return [];
  if (reducedMotionGuarded(el, ctx, name)) return [];

  if (tailwindPulse) {
    return [{ detail: `${tailwindPulse} on tiny rounded-full element` }];
  }

  const landmark = el.closest('header, nav, [role="banner"], [role="navigation"]') !== null;
  return [{
    detail: `${classSelector(el)} — ${width}x${height}px dot with infinite "${name}" animation${landmark ? ' in header/nav' : ''}`,
  }];
}

function cursorElement(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  if (new Set(['input', 'textarea', 'select', 'img', 'svg', 'script', 'style']).has(tag)) return [];
  const names = animationNames(ctx, el);
  if (!names.some((name) => hasInfiniteAnimation(ctx, el, name))) return [];
  const blinkName = names.find((name) => /blink|caret|cursor/i.test(name))
    ?? names.find((name) => keyframeTogglesVisibility(keyframes(ctx.doc, name)));
  if (!blinkName) return [];
  const contentEditable = el instanceof HTMLElement && el.isContentEditable;
  if (contentEditable || el.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null) return [];

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.top + ctx.scrollY > CURSOR_FIRST_VIEWPORT_PX) return [];
  const text = (el.textContent ?? '').trim();
  const glyphCursor = text.length === 1 && /^[_|▀-▟■▮❙❚｜]$/.test(text);
  let blockCursor = false;
  if (!glyphCursor) {
    if (text || el.children.length > 0) return [];
    const background = parseColor(styleValue(ctx, el, 'background-color'));
    const filled = (background?.a ?? 0) > CURSOR_MIN_BACKGROUND_ALPHA;
    const hasBorderFill = ['border-left-width', 'border-right-width', 'border-bottom-width']
      .some((property) => (parsePx(styleValue(ctx, el, property)) ?? 0) >= CURSOR_MIN_BORDER_PX);
    if (!filled && !hasBorderFill) return [];
    const vertical = rect.width >= 1 && rect.width <= 24 && rect.height >= 6 && rect.height <= 48 && rect.height >= rect.width;
    const underscore = rect.height >= 1 && rect.height <= 6 && rect.width >= 4 && rect.width <= 24;
    if (!vertical && !underscore) return [];
    const radius = parsePx(styleValue(ctx, el, 'border-radius')) ?? 0;
    if (radius >= CURSOR_MAX_RADIUS_RATIO * Math.min(rect.width, rect.height)) return [];
    blockCursor = true;
  }
  if (!glyphCursor && !blockCursor) return [];

  return [{
    detail: `${classSelector(el)} — ${Math.round(rect.width)}x${Math.round(rect.height)}px blinking cursor (animation "${blinkName}") in the first viewport`,
  }];
}

function translatePercentages(info: KeyframeInfo): number[] {
  const percentages: number[] = [];
  for (const frame of info.frames) {
    for (const [property, value] of declarations(frame)) {
      if (property !== 'transform') continue;
      for (const match of value.matchAll(/\btranslate(?:x|3d)?\(\s*(-?[\d.]+)%/gi)) {
        percentages.push(Number.parseFloat(match[1]!));
      }
    }
  }
  return percentages.filter(Number.isFinite);
}

function keyframeIsMarquee(info: KeyframeInfo | undefined): boolean {
  if (!info) return false;
  const percentages = translatePercentages(info);
  if (percentages.length === 0) return false;
  const hasScaleOrOpacity = info.frames.some((frame) => declarations(frame).some(([property, value]) => (
    property === 'opacity' || (property === 'transform' && /\bscale\s*\(/i.test(value))
  )));
  if (percentages.length === 1 && hasScaleOrOpacity) return false;
  const travel = percentages.length > 1
    ? Math.max(...percentages) - Math.min(...percentages)
    : Math.abs(percentages[0]!);
  return travel >= MARQUEE_MIN_TRAVEL_PERCENT;
}

function marqueeKeyframeNames(ctx: ScanContext): Set<string> {
  const names = new Set<string>();
  for (const rule of allRules(ctx.doc)) {
    if (rule.type !== 7) continue;
    const candidate = rule as CssRuleWithName;
    if (candidate.name && keyframeIsMarquee({
      name: candidate.name,
      frames: childRules(candidate)
        ? Array.from(childRules(candidate)!).filter((frame): frame is CSSKeyframeRule => frame.type === 8)
        : [],
    })) names.add(candidate.name);
  }
  return names;
}

async function marqueeHit(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const marquee = ctx.doc.querySelector('marquee');
  const hits: PageHit[] = marquee ? [{ detail: '<marquee> element', el: marquee }] : [];
  const names = marqueeKeyframeNames(ctx);
  if (names.size === 0) return hits;

  for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    const name = animationNames(ctx, el).find((candidate) => names.has(candidate) && hasInfiniteAnimation(ctx, el, candidate));
    if (!name) continue;
    hits.push({
      detail: `${classSelector(el)} — infinite horizontal loop animation "${name}"`,
      el,
    });
  }
  return hits;
}

function hoverTransform(value: string): boolean {
  return /(?:scale|rotate|translate|matrix|skew)\s*\(/i.test(value);
}

function stylesheetHoverTransform(el: Element, ctx: ScanContext): boolean {
  for (const rule of allRules(ctx.doc)) {
    if (rule.type !== 1) continue;
    const candidate = rule as CssRuleWithName;
    const selectors = (candidate.selectorText ?? '').split(',').map((selector) => selector.trim());
    if (!candidate.style || !selectors.some((selector) => {
      if (!/:hover\b/i.test(selector) || !/\bimg\b/i.test(selector)) return false;
      const base = selector.replace(/:hover\b/gi, '').trim();
      try {
        return el.matches(base) || Array.from(ctx.doc.querySelectorAll(base)).includes(el);
      } catch {
        return false;
      }
    })) continue;
    if (hoverTransform(candidate.style.getPropertyValue('transform'))) return true;
  }
  return false;
}

function imageHoverTransformHit(el: Element, ctx: ScanContext): RuleHit[] {
  if (el.tagName.toLowerCase() !== 'img') return [];
  if ([...el.classList].some((token) => /^hover:(?:scale|rotate|translate|skew)-/.test(token))) {
    return [{ detail: 'Tailwind hover transform on <img>' }];
  }
  if (stylesheetHoverTransform(el, ctx)) return [{ detail: 'img:hover { transform } rule' }];
  return [];
}

const bounceEasingRule: ElementRule = {
  id: 'bounce-easing',
  category: 'slop',
  name: 'Bounce or elastic easing',
  description: 'Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.',
  skillSection: 'Motion',
  scope: 'element',
  test: bounceEasingHit,
};

const pulsingDotRule: ElementRule = {
  id: 'pulsing-dot',
  category: 'slop',
  name: 'Pulsing status dot',
  description: 'Small pulsing status dots simulate liveness decoratively. Reserve pulse animation for indicators tied to genuinely live, changing data; a static indicator with clear labeling is honest and calmer.',
  skillSection: 'Motion',
  scope: 'element',
  test: pulsingDotHit,
};

const blinkingCursorRule: ElementRule = {
  id: 'blinking-cursor',
  category: 'slop',
  severity: 'advisory',
  name: 'Decorative blinking cursor',
  description: 'A blinking text cursor animated into a hero or landing section simulates typing where no input exists. It borrows the dev-tool aesthetic as decoration. Real editable fields draw their own caret; anywhere else, let the composition hold attention without a fake prompt.',
  skillSection: 'Motion',
  scope: 'element',
  test: cursorElement,
};

const marqueeRule: PageRule = {
  id: 'marquee',
  category: 'slop',
  name: 'Auto-scrolling marquee',
  description: 'Continuously auto-scrolling content demands attention it has not earned and hides half its content at any moment. Reserve motion for content that changes; let readers move at their own pace.',
  skillSection: 'Motion',
  scope: 'page',
  test: marqueeHit,
};

const layoutTransitionRule: ElementRule = {
  id: 'layout-transition',
  category: 'quality',
  name: 'Layout property animation',
  description: 'Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.',
  skillSection: 'Motion',
  scope: 'element',
  test: (el, ctx) => {
    const transition = styleValue(ctx, el, 'transition-property');
    if (!transition || transition === 'all' || transition === 'none') return [];
    const found = splitCssList(transition)
      .map((property) => property.toLowerCase())
      .filter((property) => LAYOUT_TRANSITION_PROPS.has(property));
    return found.length > 0 ? [{ detail: `transition: ${found.join(', ')}` }] : [];
  },
};

const imageHoverTransformRule: ElementRule = {
  id: 'image-hover-transform',
  category: 'slop',
  severity: 'advisory',
  name: 'Image hover transform',
  description: 'Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.',
  skillSection: 'Motion',
  scope: 'element',
  test: imageHoverTransformHit,
};

export const motionRules: Rule[] = [
  bounceEasingRule,
  pulsingDotRule,
  blinkingCursorRule,
  marqueeRule,
  layoutTransitionRule,
  imageHoverTransformRule,
];
