import { parseColor, isAccentColor } from '../color';
import { cssColorAlpha, parsePx } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const MONOTONOUS_MIN_VALUES = 10;
const MONOTONOUS_DOMINANT_SHARE = 0.6;
const MONOTONOUS_MAX_DISTINCT = 3;
const MONOTONOUS_MAX_SPACING_PX = 200;
const MONOTONOUS_ROUNDING_PX = 4;
const NUMBERED_LABEL_MAX_FONT_SIZE_PX = 13;
const NUMBERED_LABEL_HEADING_RATIO = 1.3;
const NUMBERED_LABEL_MIN_COUNT = 2;
const LINE_LENGTH_OVER = 5;
const CRAMPED_MIN_TEXT_LENGTH = 20;
const CRAMPED_MIN_WIDTH = 100;
const CRAMPED_MIN_HEIGHT = 30;
const CRAMPED_VERTICAL_MIN_PX = 4;
const CRAMPED_VERTICAL_FONT_RATIO = 0.3;
const CRAMPED_HORIZONTAL_MIN_PX = 8;
const CRAMPED_HORIZONTAL_FONT_RATIO = 0.5;
const BODY_EDGE_MIN_TEXT_LENGTH = 40;
const BODY_EDGE_MIN_WIDTH_RATIO = 0.5;
const BODY_EDGE_GUTTER_PX = 16;
const HEADING_RHYTHM_MIN_VIOLATIONS = 2;
const HEADING_RHYTHM_CARD_EXEMPT_HEIGHT = 200;
const HEADING_RHYTHM_MAX_BELOW_PX = 160;
const HEADING_RHYTHM_MIN_DEFICIT_PX = 12;
const HEADING_RHYTHM_MIN_BELOW_PX = 6;
const HEADING_RHYTHM_MIN_X_OVERLAP_PX = 8;
const HEADING_RHYTHM_MAX_CLUSTER_GAP_PX = 28;
const HEADING_RHYTHM_MAX_CLUSTER_HEIGHT_PX = 60;
const HEADING_RHYTHM_LABEL_RATIO = 0.75;
const HEADING_RHYTHM_VISIBILITY_ALPHA = 0.05;

const SAFE_CARD_TAGS = new Set([
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
const CARD_SHADOW_RE = /\bshadow(?:-sm|-md|-lg|-xl|-2xl)?\b/;
const CARD_BORDER_RE = /\bborder\b/;
const CARD_RADIUS_RE = /\brounded(?:-sm|-md|-lg|-xl|-2xl|-full)?\b/;
const CARD_BACKGROUND_RE = /\bbg-(?:white|gray-\d+|slate-\d+)\b/;
const OUTLINE_W_RE = /(\d+(?:\.\d+)?)\s*px/;
const OUTLINE_STYLE_RE = /\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset)\b/;
const OUTLINE_COLOR_RE = /(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*$/;
const POPOVER_RE = /\b(?:dropdown|popover|tooltip|menu|modal|dialog)\b/i;
const NUMBERED_LABEL_TAGS = new Set(['span', 'p', 'div', 'small', 'em', 'strong', 'b']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const QUALITY_TEXT_TAGS = new Set(['p', 'li', 'td', 'th', 'dd', 'blockquote', 'figcaption']);
const TEXT_EDGE_TAGS = new Set([
  'a',
  'button',
  'code',
  'dd',
  'dt',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'pre',
  'span',
  'td',
  'th',
]);
const FLUSH_SKIP_TAGS = new Set([
  'html',
  'body',
  'main',
  'header',
  'footer',
  'nav',
  'article',
  'aside',
  'button',
  'a',
  'label',
  'summary',
  'code',
  'pre',
  'input',
  'textarea',
  'select',
  'form',
  'figure',
  'table',
  'tbody',
  'thead',
  'tr',
  'td',
  'th',
]);
const KICKER_SKIP_SELECTOR = 'nav,form,table,thead,tbody,tfoot,figure,figcaption,ol,ul,li,[role="navigation"],[aria-label*="breadcrumb" i],[class*="breadcrumb" i],[aria-hidden="true"],[data-impeccable-allow-kickers]';
const KICKER_CARD_CONTEXT_SELECTOR = 'article,button,a,li,[role="listitem"],[role="option"]';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface TextLine extends Box {}

interface NumberedCandidate {
  index: number;
  labelText: string;
  headingTag: string;
  headingText: string;
  label: Element;
  heading: Element;
}

function styleValue(ctx: ScanContext, el: Element, property: string): string {
  return ctx.style(el).getPropertyValue(property).trim();
}

function finitePx(value: string): number {
  const parsed = parsePx(value);
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : 0;
}

function textContent(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function innerText(el: Element): string {
  return ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function utf16Length(value: string): number {
  return value.length;
}

function boxFromRect(rect: DOMRect): Box {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function validBox(box: Box): boolean {
  return Number.isFinite(box.left)
    && Number.isFinite(box.top)
    && Number.isFinite(box.right)
    && Number.isFinite(box.bottom)
    && box.width > 0
    && box.height > 0;
}

function classText(el: Element): string {
  return el.getAttribute('class') ?? '';
}

function colorsNearlyMatch(first: string, second: string): boolean {
  const a = parseColor(first);
  const b = parseColor(second);
  if (!a || !b) return false;
  return Math.abs(a.a - b.a) <= 0.03
    && Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) <= 3;
}

function visibleBackground(ctx: ScanContext, el: Element): boolean {
  const raw = styleValue(ctx, el, 'background-color');
  if (cssColorAlpha(raw) <= 0.05) return false;
  let parent = el.parentElement;
  while (parent) {
    const parentRaw = styleValue(ctx, parent, 'background-color');
    if (cssColorAlpha(parentRaw) > 0.05) return !colorsNearlyMatch(raw, parentRaw);
    parent = parent.parentElement;
  }
  return true;
}

function isCardLike(ctx: ScanContext, el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SAFE_CARD_TAGS.has(tag) || ['input', 'select', 'textarea', 'img', 'video', 'canvas', 'picture'].includes(tag)) return false;
  const classes = classText(el);
  const shadow = styleValue(ctx, el, 'box-shadow');
  const hasShadow = (shadow !== '' && shadow !== 'none') || CARD_SHADOW_RE.test(classes);
  const hasBorder = CARD_BORDER_RE.test(classes) || ['top', 'right', 'bottom', 'left'].some((side) => finitePx(styleValue(ctx, el, `border-${side}-width`)) > 0);
  const radius = finitePx(styleValue(ctx, el, 'border-radius'));
  const hasRadius = radius > 0 || CARD_RADIUS_RE.test(classes);
  const hasBackground = visibleBackground(ctx, el) || CARD_BACKGROUND_RE.test(classes);
  return (hasShadow || hasBorder) && (hasRadius || hasBackground);
}

async function nestedCardsHit(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const flagged: Element[] = [];
  for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    if (!isCardLike(ctx, el) || flagged.includes(el)) continue;
    const classes = classText(el);
    const position = styleValue(ctx, el, 'position');
    if (position === 'absolute' || position === 'fixed' || POPOVER_RE.test(classes)) continue;
    if (utf16Length(textContent(el)) < 10) continue;
    const box = boxFromRect(el.getBoundingClientRect());
    if (box.width < 50 || box.height < 30) continue;
    let parent = el.parentElement;
    while (parent) {
      if (isCardLike(ctx, parent)) {
        flagged.push(el);
        break;
      }
      parent = parent.parentElement;
    }
  }
  return flagged
    .filter((el) => !flagged.some((other) => other !== el && el.contains(other)))
    .map((el) => ({ detail: 'Card inside card', el }));
}

async function collectInlineSpacing(ctx: ScanContext, checkpoint: Checkpoint): Promise<number[]> {
  const values: number[] = [];
  const add = (raw: string, max = MONOTONOUS_MAX_SPACING_PX): void => {
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value > 0 && value < max) values.push(value);
  };
  const addLength = (raw: string): void => {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.endsWith('px')) add(trimmed.slice(0, -2));
    else if (trimmed.endsWith('rem')) {
      const value = Number.parseFloat(trimmed.slice(0, -3)) * 16;
      if (Number.isFinite(value) && value > 0 && value < MONOTONOUS_MAX_SPACING_PX) values.push(Math.round(value));
    }
  };
  const spacingProperties = [
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'gap',
  ];
  for (const el of Array.from(ctx.doc.querySelectorAll('*'))) {
    await checkpoint();
    const style = el.getAttribute('style') ?? '';
    for (const declaration of style.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (spacingProperties.includes(property)) addLength(declaration.slice(colon + 1));
    }
    for (const token of classText(el).split(/\s+/)) {
      const match = /^(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)$/.exec(token);
      if (match) add(String(Number.parseInt(match[1]!, 10) * 4));
    }
  }
  for (const style of Array.from(ctx.doc.querySelectorAll('style'))) {
    await checkpoint();
    const source = style.textContent ?? '';
    const declarations = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(-?(?:\d+\.?\d*|\.\d+)(?:px|rem))/gi;
    for (const match of source.matchAll(declarations)) addLength(match[1] ?? '');
    const gaps = /gap\s*:\s*(-?(?:\d+\.?\d*)px)/gi;
    for (const match of source.matchAll(gaps)) add(match[1] ?? '');
  }
  return values.map((value) => Math.round(value / MONOTONOUS_ROUNDING_PX) * MONOTONOUS_ROUNDING_PX);
}

async function monotonousSpacingHit(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const values = await collectInlineSpacing(ctx, checkpoint);
  if (values.length < MONOTONOUS_MIN_VALUES) return [];
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return [];
  const distinct = [...counts.keys()].filter((value) => value > 0);
  const share = dominant[1] / values.length;
  if (!(share > MONOTONOUS_DOMINANT_SHARE && distinct.length <= MONOTONOUS_MAX_DISTINCT)) return [];
  return [{ detail: `~${dominant[0]}px used ${dominant[1]}/${values.length} times (${Math.round(share * 100)}%)` }];
}

function parseNumberedLabel(raw: string): { index: number; text: string } | undefined {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || utf16Length(text) > 40) return undefined;
  const bare = /^(\d{2})$/.exec(text);
  const separated = /^(\d{1,2})\s*[^0-9A-Za-z_\s]\s*[^\s]/.exec(text);
  const match = bare ?? separated;
  if (!match) return undefined;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isFinite(index) && index <= 40 ? { index, text } : undefined;
}

function fontSize(ctx: ScanContext, el: Element): number {
  return Number.parseFloat(styleValue(ctx, el, 'font-size')) || 0;
}

function resolveLength(ctx: ScanContext, el: Element, property: string): number {
  const raw = styleValue(ctx, el, property);
  const px = parsePx(raw);
  if (px !== undefined) return px;
  const rem = /^(-?(?:\d+\.?\d*|\.\d+))rem$/i.exec(raw);
  if (rem) return Number.parseFloat(rem[1]!) * 16;
  const em = /^(-?(?:\d+\.?\d*|\.\d+))em$/i.exec(raw);
  if (em) return Number.parseFloat(em[1]!) * fontSize(ctx, el);
  return 0;
}

function isInSelector(el: Element, selector: string): boolean {
  try {
    return el.matches(selector) || el.closest(selector) !== null;
  } catch {
    return false;
  }
}

async function numberedCandidates(ctx: ScanContext, checkpoint: Checkpoint): Promise<NumberedCandidate[]> {
  const candidates: NumberedCandidate[] = [];
  const seen = new Set<Element>();
  for (const heading of Array.from(ctx.doc.querySelectorAll('h2, h3, h4'))) {
    await checkpoint();
    if (isInSelector(heading, KICKER_SKIP_SELECTOR)) continue;
    let label = heading.previousElementSibling;
    if (!label && heading.parentElement && heading.parentElement.firstElementChild === heading) {
      label = heading.parentElement.previousElementSibling;
    }
    if (!label || seen.has(label) || isInSelector(label, KICKER_SKIP_SELECTOR)) continue;
    if (HEADING_TAGS.has(label.tagName.toLowerCase()) || isInSelector(heading, KICKER_CARD_CONTEXT_SELECTOR)) continue;
    const parsed = parseNumberedLabel(textContent(label));
    if (!parsed || !NUMBERED_LABEL_TAGS.has(label.tagName.toLowerCase())) continue;
    const labelSize = fontSize(ctx, label);
    const headingSize = fontSize(ctx, heading);
    if (!(labelSize > 0 && labelSize <= NUMBERED_LABEL_MAX_FONT_SIZE_PX)) continue;
    if (headingSize > 0 && headingSize < labelSize * NUMBERED_LABEL_HEADING_RATIO) continue;
    const weight = Number.parseFloat(styleValue(ctx, label, 'font-weight')) || 400;
    const letterSpacing = resolveLength(ctx, label, 'letter-spacing');
    const family = styleValue(ctx, label, 'font-family');
    const transform = styleValue(ctx, label, 'text-transform');
    const color = styleValue(ctx, label, 'color');
    if (!/mono/i.test(family) && weight < 600 && letterSpacing < 0.5 && transform !== 'uppercase' && !isAccentColor(color)) continue;
    seen.add(label);
    candidates.push({
      index: parsed.index,
      labelText: parsed.text.slice(0, 24),
      headingTag: heading.tagName.toLowerCase(),
      headingText: textContent(heading).slice(0, 60).replace(/^['"]|['"]$/g, ''),
      label,
      heading,
    });
  }
  return candidates;
}

async function numberedLabelsHit(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const candidates = await numberedCandidates(ctx, checkpoint);
  if (candidates.length < NUMBERED_LABEL_MIN_COUNT || new Set(candidates.map((candidate) => candidate.index)).size < 2) return [];
  return candidates.map((candidate) => ({
    detail: `tiny numbered label "${candidate.labelText}" beside ${candidate.headingTag} "${candidate.headingText}" (${candidates.length} on page)`,
    el: candidate.label,
  }));
}

function textNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) return nodes;
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? '').trim()) nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function lineRects(el: Element): TextLine[] | undefined {
  const ownerDocument = el.ownerDocument;
  if (!ownerDocument) return undefined;
  const fragments: Box[] = [];
  for (const node of textNodes(el)) {
    const range = ownerDocument.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      const box = boxFromRect(rect);
      if (validBox(box)) fragments.push(box);
    }
    range.detach();
  }
  if (fragments.length === 0) return undefined;
  fragments.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: TextLine[] = [];
  const bands: Array<[number, number]> = [];
  for (const fragment of fragments) {
    let joined = false;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const [bandTop, bandBottom] = bands[index]!;
      if (bandBottom <= fragment.top) break;
      const overlap = Math.min(bandBottom, fragment.bottom) - Math.max(bandTop, fragment.top);
      const shorter = Math.min(bandBottom - bandTop, fragment.height);
      if (shorter <= 0 || overlap <= shorter / 2) continue;
      const line = lines[index]!;
      const gap = Math.max(fragment.left - line.right, line.left - fragment.right);
      if (gap > bandBottom - bandTop) continue;
      lines[index] = {
        left: Math.min(line.left, fragment.left),
        top: Math.min(line.top, fragment.top),
        right: Math.max(line.right, fragment.right),
        bottom: Math.max(line.bottom, fragment.bottom),
        width: Math.max(line.right, fragment.right) - Math.min(line.left, fragment.left),
        height: Math.max(line.bottom, fragment.bottom) - Math.min(line.top, fragment.top),
      };
      joined = true;
      break;
    }
    if (!joined) {
      bands.push([fragment.top, fragment.bottom]);
      lines.push(fragment);
    }
  }
  return lines;
}

function lineLengthHit(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  const text = textContent(el);
  const max = ctx.config.lineLengthMax ?? 80;
  if (!QUALITY_TEXT_TAGS.has(tag) || !text || text.length <= max || !hasDirectTextLongerThan(el, 10) || el.getBoundingClientRect().width <= 0) return [];
  const lines = lineRects(el);
  if (!lines || lines.length === 0) return [];
  const total = lines.reduce((sum, line) => sum + line.width, 0);
  if (total <= 0) return [];
  const chars = (width: number): number => text.length * width / total;
  const over = max + LINE_LENGTH_OVER;
  const long = lines.filter((line) => chars(line.width) > over);
  if (long.length < 2) return [];
  const longest = Math.max(...lines.map((line) => line.width));
  return [{
    detail: `~${Math.round(chars(longest))} chars on ${long.length} of ${lines.length} rendered lines (aim for <${max})`,
  }];
}

function hasDirectTextLongerThan(el: Element, minimum: number): boolean {
  return Array.from(el.childNodes).some((node) => (
    node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > minimum
  ));
}

function directTextRect(el: Element): Box | undefined {
  const rects: Box[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !(node.textContent ?? '').trim()) continue;
    const range = el.ownerDocument!.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      const box = boxFromRect(rect);
      if (validBox(box)) rects.push(box);
    }
    range.detach();
  }
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((value) => value.left));
  const top = Math.min(...rects.map((value) => value.top));
  const right = Math.max(...rects.map((value) => value.right));
  const bottom = Math.max(...rects.map((value) => value.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function resolvedLength(ctx: ScanContext, el: Element, property: string): number {
  const raw = styleValue(ctx, el, property);
  const px = parsePx(raw);
  if (px !== undefined) return px;
  const size = fontSize(ctx, el);
  const relative = /^(-?(?:\d+\.?\d*|\.\d+))(rem|em|%)$/i.exec(raw);
  if (relative) {
    const value = Number.parseFloat(relative[1]!);
    if (relative[2]!.toLowerCase() === 'rem') return value * 16;
    return value * size / (relative[2]!.toLowerCase() === '%' ? 100 : 1);
  }
  return 0;
}

function textDescendantsFlushSides(ctx: ScanContext, el: Element, box: Box): boolean[] {
  const flush = [false, false, false, false];
  for (const node of Array.from(el.querySelectorAll([...TEXT_EDGE_TAGS].join(',')))) {
    if (!hasDirectTextLongerThan(node, 4)) continue;
    const textBox = directTextRect(node) ?? boxFromRect(node.getBoundingClientRect());
    if (!validBox(textBox)) continue;
    if (textBox.bottom < box.top || textBox.top > box.bottom || textBox.right < box.left || textBox.left > box.right) continue;
    if (textBox.top - box.top <= 4) flush[0] = true;
    if (box.right - textBox.right <= 4) flush[1] = true;
    if (box.bottom - textBox.bottom <= 4) flush[2] = true;
    if (textBox.left - box.left <= 4) flush[3] = true;
  }
  return flush;
}

function visibleBorderSides(ctx: ScanContext, el: Element): boolean[] {
  return ['top', 'right', 'bottom', 'left'].map((side) => {
    const width = finitePx(styleValue(ctx, el, `border-${side}-width`));
    return width > 0 && cssColorAlpha(styleValue(ctx, el, `border-${side}-color`)) > 0.05;
  });
}

function visibleOutline(ctx: ScanContext, el: Element): boolean {
  let width = finitePx(styleValue(ctx, el, 'outline-width'));
  let style = styleValue(ctx, el, 'outline-style');
  let color = styleValue(ctx, el, 'outline-color');
  const shorthand = styleValue(ctx, el, 'outline');
  if (width === 0 && shorthand) {
    width = Number.parseFloat(shorthand.match(OUTLINE_W_RE)?.[1] ?? '0') || 0;
    if (!style) style = OUTLINE_STYLE_RE.test(shorthand) ? 'solid' : '';
    if (!color) color = shorthand.match(OUTLINE_COLOR_RE)?.[1] ?? '';
  }
  return width > 0 && style !== '' && style !== 'none' && cssColorAlpha(color) > 0.05;
}

function crampedPaddingHit(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  const text = textContent(el);
  const box = boxFromRect(el.getBoundingClientRect());
  const hasDirectText = hasDirectTextLongerThan(el, 10);

  if (hasDirectText) {
    if (tag === 'code' && !el.closest('pre') && text.length > CRAMPED_MIN_TEXT_LENGTH && box.width > CRAMPED_MIN_WIDTH && box.height > CRAMPED_MIN_HEIGHT) return [];
    if (!text || text.length <= CRAMPED_MIN_TEXT_LENGTH || box.width <= CRAMPED_MIN_WIDTH || box.height <= CRAMPED_MIN_HEIGHT) return [];
    const borders = ['top', 'right', 'bottom', 'left'].map((side) => finitePx(styleValue(ctx, el, `border-${side}-width`)));
    const borderCount = borders.filter((width) => width > 0).length;
    const hasBackground = visibleBackground(ctx, el);
    if (borderCount < 2 && !hasBackground) return [];
    const textBox = directTextRect(el);
    if (!textBox) return [];
    const vertical: number[] = [];
    const horizontal: number[] = [];
    if (hasBackground || borders[0]! > 0) vertical.push(textBox.top - (box.top + borders[0]!));
    if (hasBackground || borders[2]! > 0) vertical.push((box.bottom - borders[2]!) - textBox.bottom);
    if (hasBackground || borders[3]! > 0) horizontal.push(textBox.left - (box.left + borders[3]!));
    if (hasBackground || borders[1]! > 0) horizontal.push((box.right - borders[1]!) - textBox.right);
    const size = fontSize(ctx, el);
    const verticalThreshold = Math.max(CRAMPED_VERTICAL_MIN_PX, size * CRAMPED_VERTICAL_FONT_RATIO);
    const horizontalThreshold = Math.max(CRAMPED_HORIZONTAL_MIN_PX, size * CRAMPED_HORIZONTAL_FONT_RATIO);
    const verticalMinimum = Math.min(...vertical);
    const horizontalMinimum = Math.min(...horizontal);
    const px = (value: number): string => String(Math.round(value * 10) / 10);
    if (vertical.length > 0 && verticalMinimum < verticalThreshold) {
      return [{ detail: `${px(verticalMinimum)}px of space above and below the text (need ≥${verticalThreshold.toFixed(1)}px for ${size}px text)` }];
    }
    if (horizontal.length > 0 && horizontalMinimum < horizontalThreshold) {
      return [{ detail: `${px(horizontalMinimum)}px of space beside the text (need ≥${horizontalThreshold.toFixed(1)}px for ${size}px text)` }];
    }
    return [];
  }

  if (FLUSH_SKIP_TAGS.has(tag) || styleValue(ctx, el, 'position') === 'fixed' || styleValue(ctx, el, 'position') === 'absolute' || el.children.length === 0) return [];
  const borderVisible = visibleBorderSides(ctx, el);
  const outlineVisible = visibleOutline(ctx, el);
  const hasBackground = visibleBackground(ctx, el);
  if (!borderVisible.some(Boolean) && !outlineVisible && !hasBackground) return [];

  const padding = ['top', 'right', 'bottom', 'left'].map((side) => resolvedLength(ctx, el, `padding-${side}`));
  const childrenOverflow = [false, false, false, false];
  const childrenInsulate = [false, false, false, false];
  for (const child of Array.from(el.children)) {
    const childPadding = ['top', 'right', 'bottom', 'left'].map((side) => resolvedLength(ctx, child, `padding-${side}`));
    const childMargin = ['top', 'right', 'bottom', 'left'].map((side) => resolvedLength(ctx, child, `margin-${side}`));
    const childBox = boxFromRect(child.getBoundingClientRect());
    if (validBox(childBox)) {
      if (box.top - childBox.top > 1) childrenOverflow[0] = true;
      if (childBox.right - box.right > 1) childrenOverflow[1] = true;
      if (childBox.bottom - box.bottom > 1) childrenOverflow[2] = true;
      if (box.left - childBox.left > 1) childrenOverflow[3] = true;
      if (childBox.top - box.top >= 4) childrenInsulate[0] = true;
      if (box.right - childBox.right >= 4) childrenInsulate[1] = true;
      if (box.bottom - childBox.bottom >= 4) childrenInsulate[2] = true;
      if (childBox.left - box.left >= 4) childrenInsulate[3] = true;
    }
    for (let side = 0; side < 4; side += 1) {
      if (childPadding[side]! >= 4 || childMargin[side]! >= 4) childrenInsulate[side] = true;
    }
  }

  const textFlush = textDescendantsFlushSides(ctx, el, box);
  const fullBleedBackground = ctx.innerWidth > 0 && box.width >= ctx.innerWidth * 0.94 && hasBackground && !outlineVisible;
  const sideNames = ['top', 'right', 'bottom', 'left'];
  const flushSides: string[] = [];
  for (let side = 0; side < 4; side += 1) {
    const backgroundBoundsSide = hasBackground && !(fullBleedBackground && (side === 1 || side === 3));
    if ((borderVisible[side] || outlineVisible || backgroundBoundsSide)
      && padding[side]! <= 2
      && !childrenInsulate[side]
      && !childrenOverflow[side]
      && textFlush[side]) {
      flushSides.push(sideNames[side]!);
    }
  }
  if (flushSides.length === 0) return [];
  const hasTextChild = Array.from(el.children).some((child) => textContent(child).length > 4);
  if (!hasTextChild) return [];
  const firstClass = classText(el).trim().split(/\s+/)[0] ?? '';
  const boundaryParts: string[] = [];
  const visibleBorderNames = borderVisible.flatMap((visible, index) => visible ? sideNames[index] : []);
  if (visibleBorderNames.length === 4) boundaryParts.push('border');
  else if (visibleBorderNames.length > 0) boundaryParts.push(`border-${visibleBorderNames.join('/')}`);
  if (outlineVisible) boundaryParts.push('outline');
  if (hasBackground) boundaryParts.push('bg');
  const sidesLabel = flushSides.length === 4 ? 'all sides' : flushSides.join('/');
  const ident = firstClass ? `<${tag}> "${firstClass}"` : `<${tag}>`;
  return [{ detail: `${ident}: children flush against ${boundaryParts.join('+')} on ${sidesLabel} (no inset)` }];
}

function bodyEdgeHit(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = el.tagName.toLowerCase();
  // Tag first: innerText on a large container (html, body, main) is a long synchronous layout read.
  if (!['p', 'li'].includes(tag)) return [];
  const text = innerText(el);
  const box = boxFromRect(el.getBoundingClientRect());
  const viewport = ctx.innerWidth;
  if (!text || text.length <= BODY_EDGE_MIN_TEXT_LENGTH || !hasDirectTextLongerThan(el, 10) || viewport <= 0) return [];
  const ownBackground = styleValue(ctx, el, 'background-color');
  if (el.closest('nav, header') || (ownBackground !== '' && cssColorAlpha(ownBackground) > 0.05)) return [];
  const position = styleValue(ctx, el, 'position');
  if (position === 'fixed' || position === 'absolute' || box.width / viewport <= BODY_EDGE_MIN_WIDTH_RATIO) return [];
  const leftClose = box.left < BODY_EDGE_GUTTER_PX;
  const rightClose = box.right > viewport - BODY_EDGE_GUTTER_PX;
  if (!leftClose && !rightClose) return [];
  const left = Math.round(box.left);
  const right = Math.round(viewport - box.right);
  const which = leftClose && rightClose ? `left ${left}px / right ${right}px` : leftClose ? `left ${left}px` : `right ${right}px`;
  return [{ detail: `<${tag}> with ${text.length}-char body bleeds to viewport edge (${which})` }];
}

function visibleFlow(ctx: ScanContext, el: Element): boolean {
  const style = ctx.style(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const opacity = Number.parseFloat(style.opacity || '1');
  if (Number.isFinite(opacity) && opacity <= HEADING_RHYTHM_VISIBILITY_ALPHA) return false;
  const position = style.position;
  if (position === 'absolute' || position === 'fixed' || position === 'sticky') return false;
  const box = boxFromRect(el.getBoundingClientRect());
  return box.width >= 1 && box.height >= 1;
}

function overlapsX(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) >= HEADING_RHYTHM_MIN_X_OVERLAP_PX;
}

function ownTopBoundary(ctx: ScanContext, el: Element): boolean {
  const bg = parseColor(styleValue(ctx, el, 'background-color'));
  if (bg && bg.a > 0.05) return true;
  if (finitePx(styleValue(ctx, el, 'border-top-width')) > 0) return true;
  const shadow = styleValue(ctx, el, 'box-shadow');
  return shadow !== '' && shadow !== 'none';
}

async function headingRhythmHit(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  interface Candidate { el: Element; above: number; below: number; tag: string; text: string }
  const candidates: Candidate[] = [];
  for (const heading of Array.from(ctx.doc.querySelectorAll('h2, h3, h4'))) {
    await checkpoint();
    if (!visibleFlow(ctx, heading)) continue;
    const text = textContent(heading);
    if (text.length < 3) continue;
    const headingBox = boxFromRect(heading.getBoundingClientRect());
    let belowTop: number | undefined;
    let next: Element | null = heading.nextElementSibling;
    while (next) {
      if (visibleFlow(ctx, next)) {
        const nextBox = boxFromRect(next.getBoundingClientRect());
        if (nextBox.top >= headingBox.bottom - 2 && overlapsX(nextBox, headingBox)) {
          belowTop = nextBox.top;
          break;
        }
      }
      next = next.nextElementSibling;
    }
    if (belowTop === undefined) continue;

    const headingSize = fontSize(ctx, heading) || 16;
    let clusterTopElement = heading;
    let clusterTop = headingBox.top;
    for (let index = 0; index < 3; index += 1) {
      const previous = clusterTopElement.previousElementSibling;
      if (!previous || !visibleFlow(ctx, previous)) break;
      const previousBox = boxFromRect(previous.getBoundingClientRect());
      if (!overlapsX(previousBox, headingBox)) break;
      const gap = clusterTop - previousBox.bottom;
      if (gap < 0 || gap >= HEADING_RHYTHM_MAX_CLUSTER_GAP_PX || previousBox.height > HEADING_RHYTHM_MAX_CLUSTER_HEIGHT_PX) break;
      const previousText = textContent(previous);
      const previousSize = fontSize(ctx, previous) || 16;
      const labelLike = previousSize < headingSize * HEADING_RHYTHM_LABEL_RATIO || previousText.length <= 40;
      if (!labelLike || previousText.length > 80) break;
      clusterTopElement = previous;
      clusterTop = previousBox.top;
    }

    let aboveBottom: number | undefined;
    let node: Element | null = clusterTopElement;
    while (node && node !== ctx.doc.body) {
      let previous = node.previousElementSibling;
      while (previous) {
        if (visibleFlow(ctx, previous)) {
          const previousBox = boxFromRect(previous.getBoundingClientRect());
          if (previousBox.bottom <= clusterTop + 2 && overlapsX(previousBox, headingBox)) {
            aboveBottom = previousBox.bottom;
            break;
          }
        }
        previous = previous.previousElementSibling;
      }
      if (aboveBottom !== undefined) break;
      const parent: Element | null = node.parentElement;
      if (!parent || parent === ctx.doc.body || ownTopBoundary(ctx, parent)) break;
      node = parent;
    }
    if (aboveBottom === undefined) continue;

    let cardAncestor = heading.parentElement;
    let inSmallCard = false;
    while (cardAncestor && cardAncestor !== ctx.doc.body) {
      if (isCardLike(ctx, cardAncestor) && boxFromRect(cardAncestor.getBoundingClientRect()).height < HEADING_RHYTHM_CARD_EXEMPT_HEIGHT) {
        inSmallCard = true;
        break;
      }
      cardAncestor = cardAncestor.parentElement;
    }
    if (inSmallCard) continue;
    const above = Math.max(0, clusterTop - aboveBottom);
    const below = Math.max(0, belowTop - headingBox.bottom);
    if (below < HEADING_RHYTHM_MIN_BELOW_PX || below > HEADING_RHYTHM_MAX_BELOW_PX) continue;
    if (above < below * HEADING_RHYTHM_LABEL_RATIO && below - above >= HEADING_RHYTHM_MIN_DEFICIT_PX) {
      candidates.push({ el: heading, above, below, tag: heading.tagName.toLowerCase(), text: text.slice(0, 60) });
    }
  }
  if (candidates.length < HEADING_RHYTHM_MIN_VIOLATIONS) return [];
  return candidates.map((candidate) => ({
    el: candidate.el,
    detail: `${candidate.tag} "${candidate.text}" has ${Math.round(candidate.above)}px above vs ${Math.round(candidate.below)}px below — it reads as bound to the block above (${candidates.length} headings on page)`,
  }));
}

const nestedCardsRule: PageRule = {
  id: 'nested-cards',
  category: 'slop',
  name: 'Nested cards',
  description: 'Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.',
  skillSection: 'Layout & Space',
  scope: 'page',
  test: nestedCardsHit,
};

const monotonousSpacingRule: PageRule = {
  id: 'monotonous-spacing',
  category: 'slop',
  name: 'Monotonous spacing',
  description: 'The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.',
  skillSection: 'Layout & Space',
  scope: 'page',
  test: monotonousSpacingHit,
};

const numberedSectionLabelsRule: PageRule = {
  id: 'numbered-section-labels',
  category: 'slop',
  severity: 'advisory',
  name: 'Tiny numbered section labels',
  description: 'Small numeric index labels riding next to section headings, repeated section after section, are AI editorial scaffolding — a page numbering its own chapters instead of earning structure. Let hierarchy, content, and rhythm carry the sequence.',
  skillSection: 'Layout & Space',
  scope: 'page',
  test: numberedLabelsHit,
};

const lineLengthRule: ElementRule = {
  id: 'line-length',
  category: 'quality',
  severity: 'advisory',
  name: 'Line length too long',
  description: 'Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line, so it is measured on the lines that rendered and charged when more than one of them runs long. Add a max-width (65ch to 75ch) to text containers.',
  skillSection: 'Layout & Space',
  scope: 'element',
  test: lineLengthHit,
};

const crampedPaddingRule: ElementRule = {
  id: 'cramped-padding',
  category: 'quality',
  name: 'Cramped padding',
  description: 'Text is too close to the edge of its container. Two shapes: (1) an element with its own text where the space between the rendered text and the border box is too small for the font size, and (2) a wrapper whose children\'s text lands flush against a visible boundary (border, outline, or non-transparent background) with nothing to inset it. Add at least 8px (ideally 12–16px) of space inside bordered, outlined, or colored containers.',
  skillSection: 'Layout & Space',
  scope: 'element',
  test: crampedPaddingHit,
};

const bodyTextViewportEdgeRule: ElementRule = {
  id: 'body-text-viewport-edge',
  category: 'quality',
  name: 'Body text touching viewport edge',
  description: 'Body paragraphs render flush against the left or right viewport edge with no container providing horizontal padding. Wrap content in a container with at least 16px (ideally 24-32px) of horizontal padding, or apply max-width with mx-auto.',
  scope: 'element',
  test: bodyEdgeHit,
};

const headingRhythmRule: PageRule = {
  id: 'heading-rhythm',
  category: 'quality',
  name: 'Heading crowded against the previous block',
  description: 'A heading binds to the content it introduces, so the rendered space above it should exceed the space below it. When headings across a page sit as close or closer to the block above than to their own content, every section reads as if it captions the previous one. Open up the space above each heading.',
  skillSection: 'Layout & Space',
  scope: 'page',
  test: headingRhythmHit,
};

export const layoutSpaceRules: Rule[] = [
  nestedCardsRule,
  monotonousSpacingRule,
  numberedSectionLabelsRule,
  lineLengthRule,
  crampedPaddingRule,
  bodyTextViewportEdgeRule,
  headingRhythmRule,
];
