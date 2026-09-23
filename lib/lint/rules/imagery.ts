import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const SHAPE_MAX_TEXT_NODES = 2;
const SHAPE_MIN_PRIMITIVES = 8;
const SHAPE_MIN_SIZE_PX = 200;
const SHAPE_MIN_FILLS = 3;
const CHART_SHARED_RECT_SHARE = 0.75;
const ORGANIC_POLYGON_MIN_VERTICES = 10;
const ORGANIC_GRID_STEP = 25;
const ORGANIC_GRID_TOLERANCE = 0.5;
const ORGANIC_PATH_MIN_CURVES = 3;
const BURIED_MAX_OPACITY = 0.15;
const BURIED_LABEL_MAX_CHARS = 40;
const BURIED_WASH_MIN_ALPHA = 0.9;
const BURIED_SNIPPET_MAX_CHARS = 90;

const SVG_OPEN_RE = /^<svg\b[^>]*>/i;
const SVG_TEXT_RE = /<(?:text|tspan)\b/gi;
const SVG_PATTERN_RE = /<pattern\b/i;
const SVG_PRIMITIVE_RE = /<(?:rect|circle|ellipse|polygon)\b/gi;
const SVG_VIEWBOX_RE = /\bviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i;
const SVG_WIDTH_RE = /(?<![-\w])width\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i;
const SVG_HEIGHT_RE = /(?<![-\w])height\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i;
const SVG_FILL_RE = /\bfill\s*[:=]\s*["']?\s*([^"';>}\s]+)/gi;
const SVG_IGNORED_PAINTS = new Set(['none', 'transparent', 'currentcolor', 'inherit']);

const ORGANIC_CLIP_RE = /clip-path\s*:\s*(polygon|path)\s*\(([^)]*(?:\)[^;}]*)?)/gi;
const CURVE_CMD_RE = /[CSQTAcsqta]/g;
const SIGNED_NUM_RE = /-?[0-9.]+/g;

const RASTER_URL_RE = /url\(/i;
const BURIED_DECL_RE = /background(?:-image)?\s*:\s*([^;}]+)/gi;
const BURIED_GRADIENT_RE = /gradient\(/i;
const BURIED_GRADIENT_FN_RE = /(?:linear|radial|conic)-gradient\([^()]*(?:\([^()]*\)[^()]*)*\)/gi;
const BURIED_ALPHA_RE = /rgba?\(\s*[0-9.]+%?\s*,?\s*[0-9.]+%?\s*,?\s*[0-9.]+%?\s*(?:[,/]\s*([0-9.]+%?))?\s*\)|hsla?\([^)]*?(?:[,/]\s*([0-9.]+%?))?\s*\)/gi;
const BURIED_COLOR_FN_STRIP_RE = /rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const BURIED_HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const BURIED_NAMED_RE = /\b(?:white|black|ivory|beige|linen|snow|cream)\b/i;
// The JS original's lookahead backtracks: only `:normal` with no space counts as normal.
const BURIED_BLEND_RES = [/background-blend-mode\s*:\s*(?!normal)/i, /mix-blend-mode\s*:\s*(?!normal)/i];

interface CssSource {
  text: string;
  el?: Element;
}

const cssSourceCache = new WeakMap<ScanContext, CssSource[]>();

// Same-document CSS text, read once per scan: <style> blocks, style attributes, same-origin CSSOM.
async function cssSources(ctx: ScanContext, checkpoint: Checkpoint): Promise<CssSource[]> {
  const cached = cssSourceCache.get(ctx);
  if (cached) return cached;

  const sources: CssSource[] = [];
  const inlineSheets = new Set<CSSStyleSheet>();
  for (const style of Array.from(ctx.doc.querySelectorAll('style'))) {
    await checkpoint();
    if (style.textContent) sources.push({ text: style.textContent });
    if (style.sheet) inlineSheets.add(style.sheet);
  }
  for (const el of Array.from(ctx.doc.querySelectorAll('[style]'))) {
    await checkpoint();
    const value = el.getAttribute('style');
    if (value) sources.push({ text: value, el });
  }
  for (const sheet of Array.from(ctx.doc.styleSheets)) {
    if (inlineSheets.has(sheet)) continue;
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      // Cross-origin stylesheets intentionally provide no readable same-document CSS.
      continue;
    }
    for (const rule of rules) {
      await checkpoint();
      sources.push({ text: rule.cssText });
    }
  }
  cssSourceCache.set(ctx, sources);
  return sources;
}

function svgDimension(openTag: string, attrRe: RegExp, viewBoxValue: string | undefined): number | undefined {
  const attr = attrRe.exec(openTag)?.[1];
  if (attr !== undefined) return Number.parseFloat(attr);
  return viewBoxValue === undefined ? undefined : Number.parseFloat(viewBoxValue);
}

// Bars of a data chart share one width (vertical) or one height (horizontal).
function isBarChart(svg: Element): boolean {
  const rects = Array.from(svg.querySelectorAll('rect'));
  if (rects.length === 0) return false;
  const sharesOne = (attribute: string): boolean => {
    const counts = new Map<string, number>();
    for (const rect of rects) {
      const value = rect.getAttribute(attribute)?.trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Math.max(0, ...counts.values()) >= CHART_SHARED_RECT_SHARE * rects.length;
  };
  return sharesOne('width') || sharesOne('height');
}

const shapeAssembledIllustration: ElementRule = {
  id: 'shape-assembled-illustration',
  category: 'slop',
  severity: 'advisory',
  name: 'Shape-assembled illustration',
  description: 'A large inline SVG that builds a pictorial scene from a pile of primitive shapes reads as placeholder clip art, not illustration. Icons, logos, and data graphics are fine at their scale; a hero-sized visual deserves real artwork, a photograph, or a deliberately drawn graphic.',
  scope: 'element',
  test(el): RuleHit[] {
    if (el.localName !== 'svg') return [];
    const block = el.outerHTML;
    if ((block.match(SVG_TEXT_RE)?.length ?? 0) > SHAPE_MAX_TEXT_NODES) return [];
    if (SVG_PATTERN_RE.test(block)) return [];
    const primitives = block.match(SVG_PRIMITIVE_RE)?.length ?? 0;
    if (primitives < SHAPE_MIN_PRIMITIVES) return [];

    const openTag = SVG_OPEN_RE.exec(block)?.[0] ?? '';
    const viewBox = SVG_VIEWBOX_RE.exec(openTag);
    const width = svgDimension(openTag, SVG_WIDTH_RE, viewBox?.[1]);
    const height = svgDimension(openTag, SVG_HEIGHT_RE, viewBox?.[2]);
    if (width === undefined || height === undefined) return [];
    if (width < SHAPE_MIN_SIZE_PX || height < SHAPE_MIN_SIZE_PX) return [];

    const fills = new Set<string>();
    for (const match of block.matchAll(SVG_FILL_RE)) {
      const paint = (match[1] ?? '').trim().toLowerCase();
      if (paint && !SVG_IGNORED_PAINTS.has(paint)) fills.add(paint);
    }
    if (fills.size < SHAPE_MIN_FILLS) return [];
    if (isBarChart(el)) return [];

    return [{
      detail: `inline <svg> scene: ${primitives} primitive shapes, ~${Math.round(width)}x${Math.round(height)}px, ${fills.size} fill colors`,
    }];
  },
};

function organicClipDetail(kind: string, body: string): string | undefined {
  if (kind === 'path') {
    const curves = body.match(CURVE_CMD_RE)?.length ?? 0;
    return curves < ORGANIC_PATH_MIN_CURVES ? undefined : `clip-path: path() with ${curves} curve segments`;
  }
  const points = body.split(',').map((point) => point.trim()).filter(Boolean);
  if (points.length < ORGANIC_POLYGON_MIN_VERTICES) return undefined;
  let offGrid = 0;
  for (const point of points) {
    for (const number of point.match(SIGNED_NUM_RE) ?? []) {
      const value = Number.parseFloat(number);
      if (Math.abs(value - Math.round(value / ORGANIC_GRID_STEP) * ORGANIC_GRID_STEP) > ORGANIC_GRID_TOLERANCE) {
        offGrid += 1;
      }
    }
  }
  if (offGrid < points.length) return undefined;
  return `clip-path: polygon() with ${points.length} vertices approximating an organic contour`;
}

const organicClipPath: PageRule = {
  id: 'organic-clip-path',
  category: 'quality',
  name: 'Organic contour drawn as clip-path',
  description: 'A clip-path polygon with many arbitrary vertices, or a curved clip-path path(), is CSS approximating a torn edge, blob, or silhouette. It reads as the cheap version of the effect and is usually a produced or photographic material replaced with code. Derive an alpha matte from the real image, or ship the shape as a cut-out raster; keep clip-path for geometry (cut corners, diagonals, hexagons).',
  scope: 'page',
  async test(ctx, checkpoint): Promise<PageHit[]> {
    const hits: PageHit[] = [];
    for (const source of await cssSources(ctx, checkpoint)) {
      await checkpoint();
      for (const match of source.text.matchAll(ORGANIC_CLIP_RE)) {
        const detail = organicClipDetail((match[1] ?? '').toLowerCase(), match[2] ?? '');
        if (detail) hits.push({ detail, el: source.el });
      }
    }
    return hits;
  },
};

function alphaOf(token: string | undefined): number {
  if (token === undefined) return 1;
  const value = Number.parseFloat(token);
  return token.trim().endsWith('%') ? value / 100 : value;
}

function gradientAlphas(gradient: string): number[] {
  const alphas = [...gradient.matchAll(BURIED_ALPHA_RE)].map((match) => alphaOf(match[1] ?? match[2]));
  const stripped = gradient.replace(BURIED_COLOR_FN_STRIP_RE, '');
  for (const match of stripped.matchAll(BURIED_HEX_RE)) {
    const hex = match[1] ?? '';
    if (hex.length === 4) alphas.push(Number.parseInt(hex[3]!.repeat(2), 16) / 255);
    else if (hex.length === 8) alphas.push(Number.parseInt(hex.slice(6), 16) / 255);
    else alphas.push(1);
  }
  if (BURIED_NAMED_RE.test(stripped)) alphas.push(1);
  return alphas;
}

function washedRasterDetail(text: string, value: string, declIndex: number): string | undefined {
  if (!RASTER_URL_RE.test(value) || !BURIED_GRADIENT_RE.test(value)) return undefined;
  const ruleStart = Math.max(text.lastIndexOf('{', declIndex), 0);
  const closing = text.indexOf('}', declIndex);
  const rule = text.slice(ruleStart, closing === -1 ? text.length : closing);
  if (BURIED_BLEND_RES.some((re) => re.test(rule))) return undefined;

  const firstUrl = value.search(RASTER_URL_RE);
  const opaqueWash = [...value.matchAll(BURIED_GRADIENT_FN_RE)]
    .filter((match) => match.index < firstUrl)
    .some((match) => {
      const alphas = gradientAlphas(match[0]);
      return alphas.length > 0 && alphas.every((alpha) => !Number.isFinite(alpha) || alpha >= BURIED_WASH_MIN_ALPHA);
    });
  if (!opaqueWash) return undefined;
  return `raster under a near-opaque gradient wash: ${value.trim().slice(0, BURIED_SNIPPET_MAX_CHARS)}`;
}

function transparentRasterDetail(el: Element, ctx: ScanContext): string | undefined {
  const style = ctx.style(el);
  const opacity = Number.parseFloat(style.opacity);
  if (!Number.isFinite(opacity) || opacity >= BURIED_MAX_OPACITY || opacity < 0) return undefined;
  const isImg = el.localName === 'img';
  if (!isImg && !RASTER_URL_RE.test(style.backgroundImage)) return undefined;
  const label = isImg
    ? el.getAttribute('alt') ?? ''
    : (el.textContent ?? '').trim().slice(0, BURIED_LABEL_MAX_CHARS);
  return `${isImg ? '<img>' : 'raster background'} at opacity ${opacity}${label ? ` "${label}"` : ''}`;
}

const buriedRaster: PageRule = {
  id: 'buried-raster',
  category: 'quality',
  name: 'Raster buried under a wash or opacity',
  description: 'A background image under a near-opaque gradient wash, or a raster on an element at near-zero opacity, never reaches the screen: the page shows the wash, and the produced texture or photo ships as a compliance token. Let the material show (a tint under 0.9 alpha, a blend mode, an opacity you can see) or remove the file.',
  scope: 'page',
  async test(ctx, checkpoint): Promise<PageHit[]> {
    const hits: PageHit[] = [];
    for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
      await checkpoint();
      const detail = transparentRasterDetail(el, ctx);
      if (detail) hits.push({ detail, el });
    }
    for (const source of await cssSources(ctx, checkpoint)) {
      await checkpoint();
      for (const match of source.text.matchAll(BURIED_DECL_RE)) {
        const detail = washedRasterDetail(source.text, match[1] ?? '', match.index);
        if (detail) hits.push({ detail, el: source.el });
      }
    }
    return hits;
  },
};

const brokenImage: ElementRule = {
  id: 'broken-image',
  category: 'quality',
  name: 'Broken or placeholder image',
  description: '<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.',
  scope: 'element',
  test(el): RuleHit[] {
    if (el.localName !== 'img') return [];
    const src = el.getAttribute('src');
    if (src === null) return [{ detail: '<img> with no src attribute' }];
    const trimmed = src.trim();
    if (trimmed === '' || trimmed === '#') return [{ detail: `<img src="${src}">` }];
    const img = el as HTMLImageElement;
    return img.complete && img.naturalWidth === 0 ? [{ detail: `<img src="${src}"> failed to load` }] : [];
  },
};

export const imageryRules: Rule[] = [
  shapeAssembledIllustration,
  organicClipPath,
  buriedRaster,
  brokenImage,
];
