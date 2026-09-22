import {
  contrastRatio,
  hasChroma,
  parseColor,
  relativeLuminance,
  type Rgba,
} from '../color';
import { parsePx } from '../css';
import type { ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const WCAG_LARGE_TEXT_PX = 24;
const WCAG_LARGE_BOLD_TEXT_PX = 18.6667;
const WCAG_NORMAL_CONTRAST = 4.5;
const WCAG_LARGE_CONTRAST = 3;
const DESIGN_COLOR_TOLERANCE = 6;
const CREAM_MIN_CHANNEL = 209;
const CREAM_MIN_WARMTH = 6;
const CREAM_MAX_WARMTH = 48;
const AI_GRADIENT_CHROMA = 50;
const AI_PURPLE_HUE_MIN = 260;
const AI_PURPLE_HUE_MAX = 310;
const AI_CYAN_HUE_MIN = 160;
const AI_CYAN_HUE_MAX = 200;
const GLOW_CHROMA = 30;
const HALO_STOP_CHROMA = 24;
const SPOTLIGHT_MIN_WIDTH = 240;
const SPOTLIGHT_MIN_HEIGHT = 160;
const SPOTLIGHT_CHROMA = 24;

const SAFE_COLOR_TAGS = new Set([
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

const COLOR_TOKEN_RE = /rgba?\([^)]*\)|hsla?\([^)]*\)|(?:oklch|oklab|lch|lab|color)\([^)]*\)|#[\da-f]{3,8}\b|transparent/gi;
const NUMBER_RE = /-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw)?/gi;

function colorHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

function hasDirectText(el: Element): boolean {
  return directText(el).length > 0;
}

function splitTopLevelCommas(value: string): string[] {
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

function colorTokens(value: string): Array<{ color: Rgba | undefined; text: string; source: string }> {
  return [...value.matchAll(COLOR_TOKEN_RE)].map((match) => {
    const source = match[0]!;
    return {
      color: source.toLowerCase() === 'transparent'
        ? { r: 0, g: 0, b: 0, a: 0 }
        : parseColor(source),
      text: source,
      source: value,
    };
  });
}

function gradientColors(value: string): Rgba[] {
  if (!/gradient\s*\(/i.test(value)) return [];
  return colorTokens(value)
    .map((token) => token.color)
    .filter((color): color is Rgba => color !== undefined);
}

interface GradientStop {
  color: Rgba | undefined;
  raw: string;
}

function radialStops(value: string): GradientStop[] | undefined {
  const match = /radial-gradient\s*\(/i.exec(value);
  if (!match || /repeating-radial-gradient\s*\(/i.test(value)) return undefined;
  const start = value.indexOf('(', match.index);
  if (start < 0) return undefined;
  let depth = 0;
  let end = -1;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return undefined;
  const args = splitTopLevelCommas(value.slice(start + 1, end));
  const stops = args
    .map((raw) => ({ color: colorTokens(raw)[0]?.color, raw }))
    .filter((stop) => stop.color !== undefined || /^\s*transparent(?:\s|$)/i.test(stop.raw));
  return stops.length >= 2 ? stops : undefined;
}

function hue(color: Rgba): number {
  const channels = [color.r, color.g, color.b].map((channel) => channel / 255);
  const red = channels[0]!;
  const green = channels[1]!;
  const blue = channels[2]!;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const delta = max - min;
  let result: number;
  if (max === red) result = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) result = (blue - red) / delta + 2;
  else result = (red - green) / delta + 4;
  return Math.round(result * 60);
}

function isPurpleOrCyan(color: Rgba, chromaThreshold = AI_GRADIENT_CHROMA): 'purple' | 'cyan' | undefined {
  const colorHue = hue(color);
  if (hasChroma(color, chromaThreshold)) {
    if (colorHue >= AI_PURPLE_HUE_MIN && colorHue <= AI_PURPLE_HUE_MAX) return 'purple';
    if (colorHue >= AI_CYAN_HUE_MIN && colorHue <= AI_CYAN_HUE_MAX) return 'cyan';
  }
  return undefined;
}

function composite(over: Rgba, under: Rgba): Rgba {
  const alpha = Math.max(0, Math.min(1, over.a));
  const underAlpha = Math.max(0, Math.min(1, under.a));
  const outputAlpha = alpha + underAlpha * (1 - alpha);
  if (outputAlpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (over.r * alpha + under.r * underAlpha * (1 - alpha)) / outputAlpha,
    g: (over.g * alpha + under.g * underAlpha * (1 - alpha)) / outputAlpha,
    b: (over.b * alpha + under.b * underAlpha * (1 - alpha)) / outputAlpha,
    a: outputAlpha,
  };
}

function styleValue(ctx: ScanContext, el: Element, property: string): string {
  const style = ctx.style(el);
  return style.getPropertyValue(property)
    || (style as unknown as Record<string, string>)[property]
    || '';
}

function styleColor(ctx: ScanContext, el: Element, property: string): Rgba | undefined {
  return parseColor(styleValue(ctx, el, property));
}

interface ResolvedBackground {
  colors?: Rgba[];
  unresolved: boolean;
}

function resolvedBackground(ctx: ScanContext, start: Element): ResolvedBackground {
  const overlays: Rgba[] = [];
  let current: Element | null = start;
  while (current) {
    const backgroundValue = styleValue(ctx, current, 'backgroundColor');
    const background = parseColor(backgroundValue);
    const backgroundImage = styleValue(ctx, current, 'backgroundImage');
    const normalizedBackground = backgroundValue.trim().toLowerCase();

    if (
      background === undefined
      && normalizedBackground !== ''
      && normalizedBackground !== 'transparent'
      && normalizedBackground !== 'none'
    ) {
      return { unresolved: true };
    }

    if (background && background.a > 0.1) {
      if (background.a >= 0.99) {
        let color = background;
        for (let index = overlays.length - 1; index >= 0; index -= 1) color = composite(overlays[index]!, color);
        return { colors: [color], unresolved: false };
      }
      overlays.push(background);
    }

    if (backgroundImage && backgroundImage !== 'none' && /(gradient|url)\s*\(/i.test(backgroundImage)) {
      if (/url\s*\(/i.test(backgroundImage)) return { unresolved: true };
      const stops = gradientColors(backgroundImage);
      if (stops.length === 0) return { unresolved: true };
      const base = current.parentElement
        ? resolvedBackground(ctx, current.parentElement)
        : { colors: [{ r: 255, g: 255, b: 255, a: 1 }], unresolved: false };
      if (base.unresolved || !base.colors?.length) return { unresolved: true };
      const baseColor = base.colors[0]!;
      return {
        colors: stops.map((stop) => {
          let color = composite(stop, baseColor);
          for (let index = overlays.length - 1; index >= 0; index -= 1) color = composite(overlays[index]!, color);
          return color;
        }),
        unresolved: false,
      };
    }
    current = current.parentElement;
  }

  let color: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (let index = overlays.length - 1; index >= 0; index -= 1) color = composite(overlays[index]!, color);
  return { colors: [color], unresolved: false };
}

function isLargeText(ctx: ScanContext, el: Element): boolean {
  const fontSize = parsePx(styleValue(ctx, el, 'fontSize')) ?? 16;
  const fontWeight = Number.parseFloat(styleValue(ctx, el, 'fontWeight')) || 400;
  return fontSize >= WCAG_LARGE_TEXT_PX || (fontSize >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
}

// Deliberate parity boundary: the browser port keeps impeccable's analytic
// solid/gradient style path and abstains when a URL/image or other background
// cannot be resolved from computed styles. The separate visual-contrast pixel
// variant is intentionally not part of this content-script rule pack.
function lowContrastHit(ctx: ScanContext, el: Element): RuleHit[] {
  if (!hasDirectText(el)) return [];
  const text = parseColor(styleValue(ctx, el, 'color'));
  if (!text) return [];
  const clip = styleValue(ctx, el, 'backgroundClip') || styleValue(ctx, el, 'webkitBackgroundClip');
  if (clip === 'text') return [];
  const background = resolvedBackground(ctx, el);
  if (background.unresolved || !background.colors?.length) return [];
  const tag = el.tagName.toLowerCase();
  if (SAFE_COLOR_TAGS.has(tag)) {
    const ownBackground = parseColor(styleValue(ctx, el, 'backgroundColor'));
    const ownGradient = /gradient\s*\(/i.test(styleValue(ctx, el, 'backgroundImage'));
    const fontSize = parsePx(styleValue(ctx, el, 'fontSize')) ?? 16;
    if (!((ownBackground && ownBackground.a > 0.5) || ownGradient) || fontSize < 9) return [];
  }
  const ratios = background.colors.map((color) => contrastRatio(text, color));
  const worstIndex = ratios.reduce((best, ratio, index) => ratio < ratios[best]! ? index : best, 0);
  const ratio = ratios[worstIndex]!;
  const threshold = isLargeText(ctx, el) ? WCAG_LARGE_CONTRAST : WCAG_NORMAL_CONTRAST;
  if (ratio >= threshold) return [];
  return [{
    detail: `${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorHex(text)} on ${colorHex(background.colors[worstIndex]!)}`,
  }];
}

function grayOnColorHit(ctx: ScanContext, el: Element): RuleHit[] {
  if (!hasDirectText(el)) return [];
  const text = styleColor(ctx, el, 'color');
  if (!text || !isGrayInk(text)) return [];
  const background = resolvedBackground(ctx, el);
  if (background.unresolved || !background.colors?.length || !background.colors.every((color) => hasChroma(color, 40))) return [];
  return [{
    detail: `text ${colorHex(text)} on bg ${colorHex(background.colors[0]!)}`,
  }];
}

function isGrayInk(color: Rgba): boolean {
  const channels = [color.r, color.g, color.b].map((channel) => channel / 255);
  const red = channels[0]!;
  const green = channels[1]!;
  const blue = channels[2]!;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const saturation = max === min
    ? 0
    : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation < 0.2 && lightness > 0.2 && lightness < 0.85;
}

function gradientTextHit(ctx: ScanContext, el: Element): RuleHit[] {
  const clip = styleValue(ctx, el, 'backgroundClip') || styleValue(ctx, el, 'webkitBackgroundClip');
  if (clip === 'text' && /gradient/i.test(styleValue(ctx, el, 'backgroundImage'))) {
    return [{ detail: 'background-clip: text + gradient' }];
  }
  return [];
}

function creamColor(color: Rgba | undefined): boolean {
  if (!color || Math.min(color.r, color.g, color.b) < CREAM_MIN_CHANNEL) return false;
  if (!(color.r >= color.g && color.g >= color.b)) return false;
  const warmth = color.r - color.b;
  return warmth >= CREAM_MIN_WARMTH && warmth <= CREAM_MAX_WARMTH;
}

const CREAM_CLASS_COLORS: Record<string, string> = {
  'bg-amber-50': '#fffbeb',
  'bg-amber-100': '#fef3c7',
  'bg-orange-50': '#fff7ed',
  'bg-orange-100': '#ffedd5',
  'bg-yellow-50': '#fefce8',
  'bg-stone-100': '#f5f5f4',
};

function creamClass(el: Element): string | undefined {
  for (const token of el.classList) {
    if (CREAM_CLASS_COLORS[token] && creamColor(parseColor(CREAM_CLASS_COLORS[token]))) return token;
    const arbitrary = /^bg-\[([^\]]+)\]$/.exec(token)?.[1]?.replaceAll('_', ' ');
    if (arbitrary && creamColor(parseColor(arbitrary))) return token;
  }
  return undefined;
}

function creamPaletteHit(ctx: ScanContext): RuleHit[] {
  const body = ctx.doc.body;
  const root = ctx.doc.documentElement;
  const bodyColor = body ? styleColor(ctx, body, 'backgroundColor') : undefined;
  const rootColor = styleColor(ctx, root, 'backgroundColor');
  const color = creamColor(bodyColor) ? bodyColor : creamColor(rootColor) ? rootColor : undefined;
  if (color) {
    return [{ detail: `cream/beige page background rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})` }];
  }
  for (const el of [body, root]) {
    const token = el && creamClass(el);
    if (token) return [{ detail: `cream/beige page background (Tailwind ${token})` }];
  }
  return [];
}

function aiPaletteReading(ctx: ScanContext, el: Element): {
  hits: RuleHit[];
  tells: Set<'purple' | 'cyan'>;
  ink?: RuleHit;
} {
  const hits: RuleHit[] = [];
  const tells = new Set<'purple' | 'cyan'>();
  for (const color of gradientColors(styleValue(ctx, el, 'backgroundImage'))) {
    const tell = isPurpleOrCyan(color);
    if (!tell) continue;
    tells.add(tell);
    hits.push({
      detail: tell === 'purple' ? 'Purple/violet gradient background' : 'Cyan gradient background',
    });
    break;
  }
  if (hasDirectText(el)) {
    const text = parseColor(styleValue(ctx, el, 'color'));
    const tag = el.tagName.toLowerCase();
    if (text && hasChroma(text, AI_GRADIENT_CHROMA) && hue(text) >= AI_PURPLE_HUE_MIN && hue(text) <= AI_PURPLE_HUE_MAX
      && (/^h[1-3]$/.test(tag) || (parsePx(styleValue(ctx, el, 'fontSize')) ?? 16) >= 20)) {
      hits.push({ detail: `Purple/violet text (${colorHex(text)}) on heading` });
    }
    const inkTell = text ? isPurpleOrCyan(text, 80) : undefined;
    const parent = el.parentElement;
    const parentBackground = parent ? resolvedBackground(ctx, parent) : { colors: undefined, unresolved: false };
    if (inkTell && parentBackground.colors?.some((color) => relativeLuminance(color) < 0.1)) {
      tells.add(inkTell);
      return { hits, tells, ink: { detail: `${inkTell === 'purple' ? 'Purple/violet' : 'Cyan'} neon text on dark background` } };
    }
  }
  return { hits, tells };
}

function aiPalettePageHits(ctx: ScanContext): PageHit[] {
  const readings = Array.from(ctx.doc.querySelectorAll('*'))
    .filter((el) => el !== ctx.doc.body && el !== ctx.doc.documentElement)
    .map((el) => ({ el, reading: aiPaletteReading(ctx, el) }));
  const tells = new Set(readings.flatMap(({ reading }) => [...reading.tells]));
  const hits: PageHit[] = [];
  for (const { el, reading } of readings) {
    for (const hit of reading.hits) hits.push({ ...hit, el });
    if (reading.ink && tells.size >= 2) hits.push({ ...reading.ink, el });
  }
  return hits;
}

function shadowLayers(value: string): string[] {
  return splitTopLevelCommas(value).filter((layer) => layer && layer.toLowerCase() !== 'none');
}

function shadowColor(layer: string): { color: Rgba; before: string; after: string } | undefined {
  const match = COLOR_TOKEN_RE.exec(layer);
  COLOR_TOKEN_RE.lastIndex = 0;
  if (!match) return undefined;
  const token = match[0];
  const color = token.toLowerCase() === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(token);
  if (!color) return undefined;
  return { color, before: layer.slice(0, match.index), after: layer.slice(match.index + token.length) };
}

function shadowLengths(layer: string): number[] {
  const info = shadowColor(layer);
  if (!info) return [];
  const numeric = `${info.before} ${info.after}`.match(NUMBER_RE) ?? [];
  return numeric.map((value) => Number.parseFloat(value)).filter(Number.isFinite);
}

function darkBackground(ctx: ScanContext, el: Element): boolean {
  const parent = el.parentElement ?? el;
  const background = resolvedBackground(ctx, parent);
  return !!background.colors?.some((color) => relativeLuminance(color) < 0.1);
}

function darkGlowHit(ctx: ScanContext, el: Element): RuleHit[] {
  const dark = darkBackground(ctx, el);
  let textShadow = styleValue(ctx, el, 'textShadow');
  if (textShadow && el.parentElement && styleValue(ctx, el.parentElement, 'textShadow') === textShadow) {
    textShadow = '';
  }
  for (const [property, raw] of [
    ['box-shadow', styleValue(ctx, el, 'boxShadow')],
    ['text-shadow', textShadow],
  ] as const) {
    for (const layer of shadowLayers(raw)) {
      const info = shadowColor(layer);
      if (!info || !hasChroma(info.color, GLOW_CHROMA)) continue;
      const lengths = shadowLengths(layer);
      if (lengths.length < 3 || lengths[2]! <= 4) continue;
      if (lengths[0] === 0 && lengths[1] === 0) {
        return [{ detail: `Zero-offset ${property} glow (${colorHex(info.color)})` }];
      }
      if (dark) {
        return [{ detail: `Colored ${property} glow (${colorHex(info.color)}) on dark background` }];
      }
    }
  }
  return [];
}

function pxStopAtOrBelow24(raw: string): boolean {
  return [...raw.matchAll(/(-?(?:\d+\.?\d*|\.\d+))px\b/gi)].some((match) => Math.abs(Number.parseFloat(match[1]!)) <= 24);
}

function radialHaloHit(ctx: ScanContext, el: Element): RuleHit[] {
  const rootBackground = ctx.doc.body ? styleColor(ctx, ctx.doc.body, 'backgroundColor') : undefined;
  const htmlBackground = styleColor(ctx, ctx.doc.documentElement, 'backgroundColor');
  const dark = [rootBackground, htmlBackground].some((color) => color && color.a > 0.5 && relativeLuminance(color) < 0.1);
  if (!dark) return [];
  const value = styleValue(ctx, el, 'backgroundImage');
  const stops = radialStops(value);
  if (!stops || stops.some((stop) => pxStopAtOrBelow24(stop.raw))) return [];
  const first = stops[0]!.color;
  const last = stops[stops.length - 1]!.color;
  if (!first || !last || first.a < 0.7 || last.a > 0.05 || !hasChroma(first, HALO_STOP_CHROMA)) return [];
  return [{ detail: `radial-gradient halo (${colorHex(first)} → transparent) on dark page` }];
}

function spotlightLabel(el: Element): string {
  const text = directText(el).replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 40);
  return el.className && typeof el.className === 'string' ? el.className.split(/\s+/)[0] || 'section' : 'section';
}

function radialSpotlightHit(ctx: ScanContext, el: Element): RuleHit[] {
  const stops = radialStops(styleValue(ctx, el, 'backgroundImage'));
  if (!stops || stops.length < 2) return [];
  const last = stops[stops.length - 1]!.color;
  if (!last || last.a > 0.05) return [];
  const colored = stops.filter((stop) => stop.color && stop.color.a > 0.05) as Array<{ color: Rgba; raw: string }>;
  if (colored.length === 0 || colored.length > 2 || colored.some((stop) => stop.color.a >= 0.45)) return [];
  const chromatic = colored.find((stop) => hasChroma(stop.color, SPOTLIGHT_CHROMA));
  if (!chromatic) return [];
  const width = parsePx(styleValue(ctx, el, 'width'));
  const height = parsePx(styleValue(ctx, el, 'height'));
  if (width === undefined || height === undefined || width < SPOTLIGHT_MIN_WIDTH || height < SPOTLIGHT_MIN_HEIGHT) return [];
  return [{
    detail: `radial-gradient spotlight glow "${spotlightLabel(el)}" (${colorHex(chromatic.color)} a${chromatic.color.a.toFixed(2)} → transparent) on ${Math.round(width)}x${Math.round(height)} surface`,
  }];
}

function designColorAllowed(raw: string, configured: string[]): boolean {
  const color = parseColor(raw);
  if (!color || color.a <= 0.05) return true;
  return configured.some((entry) => {
    const allowed = parseColor(entry);
    return !!allowed
      && Math.max(Math.abs(color.r - allowed.r), Math.abs(color.g - allowed.g), Math.abs(color.b - allowed.b)) <= DESIGN_COLOR_TOLERANCE;
  });
}

function designSystemHit(ctx: ScanContext, el: Element): RuleHit[] {
  const colors = ctx.config.designSystem?.colors;
  if (!colors || colors.length === 0) return [];
  const tag = el.tagName.toLowerCase();
  const sample = directText(el).slice(0, 40);
  const checks: Array<{ kind: string; raw: string }> = [];
  if (hasDirectText(el)) checks.push({ kind: 'text color', raw: styleValue(ctx, el, 'color') });

  const background = styleValue(ctx, el, 'backgroundColor');
  if (background && !designColorAllowed(background, ['transparent'])) {
    checks.push({ kind: 'background', raw: background });
  }
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if ((parsePx(styleValue(ctx, el, `border${side}Width`)) ?? 0) > 0) {
      checks.push({
        kind: `border-${side.toLowerCase()}`,
        raw: styleValue(ctx, el, `border${side}Color`),
      });
    }
  }
  if ((parsePx(styleValue(ctx, el, 'outlineWidth')) ?? 0) > 0) {
    checks.push({ kind: 'outline', raw: styleValue(ctx, el, 'outlineColor') });
  }

  return checks
    .filter(({ raw }) => raw.trim() && !designColorAllowed(raw, colors))
    .map(({ kind, raw }) => ({
      detail: `${kind} ${raw.trim()} on ${tag}${sample ? ` "${sample}"` : ''} is outside DESIGN.md colors`,
      ignoreValue: raw.trim(),
    }));
}

const lowContrastRule: ElementRule = {
  id: 'low-contrast',
  category: 'quality',
  name: 'Low contrast text',
  description: 'Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.',
  scope: 'element',
  test: (el, ctx) => lowContrastHit(ctx, el),
};

const grayOnColorRule: ElementRule = {
  id: 'gray-on-color',
  category: 'quality',
  name: 'Gray text on colored background',
  description: 'Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => grayOnColorHit(ctx, el),
};

const gradientTextRule: ElementRule = {
  id: 'gradient-text',
  category: 'slop',
  name: 'Gradient text',
  description: 'Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => gradientTextHit(ctx, el),
};

const creamPaletteRule: PageRule = {
  id: 'cream-palette',
  category: 'slop',
  name: 'Cream / beige palette',
  description: 'A warm cream or beige page background has become the default "tasteful" AI surface, reached for by reflex. Choose a background that comes from a deliberate palette, not the safe warm off-white.',
  skillSection: 'Color & Contrast',
  scope: 'page',
  test: (ctx) => creamPaletteHit(ctx),
};

const aiColorPaletteRule: PageRule = {
  id: 'ai-color-palette',
  category: 'slop',
  name: 'AI color palette',
  description: 'Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. A gradient in one of those hues is the tell on its own; flat neon ink on a dark ground is charged once a second tell hue joins it. Choose a distinctive, intentional palette.',
  skillSection: 'Color & Contrast',
  scope: 'page',
  test: (ctx) => aiPalettePageHits(ctx),
};

const darkGlowRule: ElementRule = {
  id: 'dark-glow',
  category: 'slop',
  name: 'Glowing shadow accents',
  description: 'Colored glow shadows — a zero-offset chromatic halo (box- or text-shadow) on any background, or any colored blurred shadow on a dark background — are the default "cool" look of AI-generated UIs. Use neutral elevation shadows and subtle, purposeful lighting instead.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => darkGlowHit(ctx, el),
};

const radialHaloRule: ElementRule = {
  id: 'radial-halo',
  category: 'slop',
  name: 'Radial-gradient background halo',
  description: 'A chromatic radial-gradient wash — saturated at the center, fading to transparent — used as a decorative background glow on a dark page. Same tell as glowing shadows, drawn with a gradient instead of a shadow. Ground the surface with a solid or subtly shifted background instead.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => radialHaloHit(ctx, el),
};

const radialSpotlightRule: ElementRule = {
  id: 'radial-spotlight-glow',
  category: 'slop',
  name: 'Decorative radial spotlight glow',
  description: 'A soft, low-opacity accent-colored radial gradient fading to transparent, dropped behind a hero or section as a "spotlight." It is a reflex AI decoration — the translucent cousin of the saturated radial halo. Let the surface stand on its own, or light the composition with a deliberate material accent rather than a floating colored haze.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => radialSpotlightHit(ctx, el),
};

const designSystemColorRule: ElementRule = {
  id: 'design-system-color',
  category: 'quality',
  severity: 'advisory',
  name: 'Color outside DESIGN.md',
  description: 'A literal color is outside the DESIGN.md palette and sidecar tonal ramps. This may be legitimate, but it should be an intentional design-system addition rather than drift.',
  skillSection: 'Color & Contrast',
  scope: 'element',
  test: (el, ctx) => designSystemHit(ctx, el),
};

export const colorRules: Rule[] = [
  lowContrastRule,
  grayOnColorRule,
  gradientTextRule,
  creamPaletteRule,
  aiColorPaletteRule,
  darkGlowRule,
  radialHaloRule,
  radialSpotlightRule,
  designSystemColorRule,
];
