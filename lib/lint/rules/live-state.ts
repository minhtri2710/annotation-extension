import { parseColor } from '../color';
import { parsePx } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';
import { classSelector, styleValue } from '../dom';
import { borderSideCount, directText, isScreenReaderOnly, numberValue, occlusionRules, roundValue } from './occlusion';

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
const REPEATED_TEXT_SKIP_SELECTOR = 'table,select,datalist,nav,menu,[role="navigation"],[role="menu"],[role="menubar"],[role="listbox"],[role="grid"],[role="tablist"],[role="radiogroup"],[aria-hidden="true"]';
const DECORATIVE_IDENTIFIER_RE = /\b(?:art|bg|background|badge|blob|crop|decor|dot|glow|grain|image|mask|ornament|overlay|photo|scrim|shadow|shine|texture)\b/i;
const VIEWPORT_IDENTIFIER_RE = /\b(?:carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)\b/i;
const DEMO_IDENTIFIER_RE = /\b(?:demo-area|demo-stage|demo-viewport)\b/i;
const CAROUSEL_ROLE_RE = /\b(?:carousel|slider)\b/i;
const INTERACTIVE_SELECTOR = 'a[href],button,input,select,summary,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="dialog"],[role="link"],[role="listbox"],[role="menu"],[role="menuitem"],[role="option"],[role="tooltip"]';

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

function hasDirectText(el: Element): boolean {
  return directText(el).length > 0;
}

function isScroller(ctx: ScanContext, el: Element): boolean {
  return /(?:auto|scroll)/.test(styleValue(ctx, el, 'overflow-x'))
    || /(?:auto|scroll)/.test(styleValue(ctx, el, 'overflow'));
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

const edgeFlushCardsRule: PageRule = {
  id: 'edge-flush-cards',
  category: 'quality',
  name: 'Cards flush against the scroller edge',
  description: 'Cards inside a horizontal scroller or tab panel sit flush against the container edge at rest while keeping a gutter on the other side, so their edges and rounded corners get cut off. Usually the panel is sized wider than its clip box. Keep a consistent inset on both sides.',
  scope: 'page',
  test: edgeFlushCards,
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
  ...occlusionRules,
  firstViewportColumnOverflowRule,
  textOverflowRule,
  repeatedContainerTextRule,
  clippedOverflowContainerRule,
];
