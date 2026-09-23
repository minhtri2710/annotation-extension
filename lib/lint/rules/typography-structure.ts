import { isAccentColor, parseColor } from '../color';
import { parsePx, trackingEm } from '../css';
import type { Checkpoint, ElementRule, PageHit, PageRule, Rule, RuleHit, ScanContext } from '../engine';

const TYPE_HIERARCHY_MIN_ROLES = 3;
const TYPE_HIERARCHY_MIN_STEP_RATIO = 1.25;
const OVERUSED_FONT_MIN_TEXT_ELEMENTS = 20;
const ICON_TILE_MIN_PX = 32;
const ICON_TILE_MAX_PX = 128;
const ICON_TILE_MIN_ASPECT = 0.7;
const ICON_TILE_MAX_ASPECT = 1.4;
const ITALIC_SERIF_MIN_PX = 48;
const HERO_HEADING_MIN_PX = 48;
const HERO_EYEBROW_MAX_PX = 14;
const HERO_EYEBROW_MIN_TRACKING_PX = 1.6;
const KICKER_MIN_HEADING_PX = 20;
const KICKER_MAX_PX = 14;
const KICKER_MIN_TRACKING_EM = 0.06;
const DESIGN_FONT_SIZE_TOLERANCE_PX = 0.5;

const CSS_GENERIC_FONTS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'inherit',
  'initial',
  'unset',
  'revert',
]);
const GENERIC_FONTS = new Set([
  ...CSS_GENERIC_FONTS,
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
]);
const OVERUSED_FONTS = new Set([
  'inter',
  'roboto',
  'open sans',
  'lato',
  'montserrat',
  'arial',
  'helvetica',
  'fraunces',
  'instrument sans',
  'instrument serif',
  'geist',
  'geist sans',
  'geist mono',
  'mona sans',
  'plus jakarta sans',
  'space grotesk',
  'recoleta',
]);
const KNOWN_SERIF_FONTS = new Set([
  'fraunces',
  'recoleta',
  'newsreader',
  'playfair display',
  'playfair',
  'cormorant',
  'cormorant garamond',
  'garamond',
  'eb garamond',
  'tiempos',
  'tiempos headline',
  'tiempos text',
  'lora',
  'vollkorn',
  'spectral',
  'source serif pro',
  'source serif 4',
  'source serif',
  'ibm plex serif',
  'merriweather',
  'libre caslon',
  'libre baskerville',
  'baskerville',
  'georgia',
  'times new roman',
  'times',
  'dm serif display',
  'dm serif text',
  'instrument serif',
  'gt sectra',
  'ogg',
  'canela',
  'freight display',
  'freight text',
]);
const TYPE_HIERARCHY_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,td,th,dd,blockquote,figcaption';
const TYPE_HIERARCHY_SKIP_SELECTOR = '.impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip, [id^="impeccable-live-"]';
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';
const HEADING_WITH_ARIA_SELECTOR = 'h1,h2,h3,h4,[role="heading"]';
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
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
const KICKER_SKIP_SELECTOR = 'nav,form,table,thead,tbody,tfoot,figure,figcaption,ol,ul,li,[role="navigation"],[aria-label*="breadcrumb" i],[class*="breadcrumb" i],[aria-hidden="true"],[data-impeccable-allow-kickers]';
const KICKER_CARD_CONTEXT_SELECTOR = 'article,button,a,li,[role="listitem"],[role="option"]';
const BRAND_FONT_DOMAINS: Record<string, string[]> = {
  roboto: ['google.com', 'youtube.com', 'android.com', 'chromium.org', 'chrome.com', 'web.dev', 'gstatic.com', 'firebase.google.com'],
  'google sans': ['google.com', 'youtube.com', 'android.com', 'chromium.org', 'chrome.com', 'web.dev', 'gstatic.com', 'firebase.google.com'],
  'product sans': ['google.com', 'youtube.com', 'android.com', 'chromium.org', 'chrome.com', 'web.dev', 'gstatic.com', 'firebase.google.com'],
  geist: ['vercel.com', 'nextjs.org', 'v0.app'],
  'geist sans': ['vercel.com', 'nextjs.org', 'v0.app'],
  'geist mono': ['vercel.com', 'nextjs.org', 'v0.app'],
  'mona sans': ['github.com', 'githubnext.com'],
};

function styleValue(ctx: ScanContext, el: Element, property: string, pseudo?: string): string {
  return ctx.style(el, pseudo).getPropertyValue(property).trim();
}

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('');
}

function hasDirectText(el: Element): boolean {
  return directText(el).trim().length > 0;
}

function textSample(el: Element, limit = 40): string {
  return collapseWhitespace(el.textContent ?? '').slice(0, limit);
}

function parseFontSize(ctx: ScanContext, el: Element): number {
  return parsePx(styleValue(ctx, el, 'font-size')) ?? 0;
}

function parseFontWeight(ctx: ScanContext, el: Element): number {
  const value = Number.parseFloat(styleValue(ctx, el, 'font-weight'));
  return Number.isFinite(value) ? value : 400;
}

function parseLetterSpacing(ctx: ScanContext, el: Element): number {
  return parsePx(styleValue(ctx, el, 'letter-spacing')) ?? 0;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function primaryFont(fontFamily: string, skipCssGenerics: boolean): string {
  for (const token of fontFamily.split(',')) {
    const font = token.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    if (font && !(skipCssGenerics ? CSS_GENERIC_FONTS : GENERIC_FONTS).has(font)) return font;
  }
  return '';
}

function isBrandFontOnOwnDomain(font: string, hostname: string): boolean {
  const domains = BRAND_FONT_DOMAINS[font];
  if (!domains) return false;
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isRendered(ctx: ScanContext, el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (current.hasAttribute('hidden')) return false;
    if (NON_RENDERED_TAGS.has(tagName(current))) return false;
    const display = styleValue(ctx, current, 'display').toLowerCase();
    const visibility = styleValue(ctx, current, 'visibility').toLowerCase();
    const contentVisibility = styleValue(ctx, current, 'content-visibility').toLowerCase();
    const opacity = Number.parseFloat(styleValue(ctx, current, 'opacity'));
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse' || contentVisibility === 'hidden') return false;
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    current = current.parentElement;
  }
  return true;
}

function elementRect(ctx: ScanContext, el: Element): { top: number; bottom: number; width: number; height: number; hasLayout: boolean } {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, hasLayout: true };
  }
  const width = parsePx(styleValue(ctx, el, 'width')) ?? 0;
  const height = parsePx(styleValue(ctx, el, 'height')) ?? 0;
  return { top: 0, bottom: height, width, height, hasLayout: false };
}

function isAccentDashPseudo(ctx: ScanContext, el: Element): boolean {
  for (const pseudo of ['::before', '::after']) {
    const content = styleValue(ctx, el, 'content', pseudo);
    if (!content || content === 'none') continue;
    const width = parsePx(styleValue(ctx, el, 'width', pseudo)) ?? 0;
    const height = parsePx(styleValue(ctx, el, 'height', pseudo)) ?? 0;
    if (width < 8 || width > 80 || height < 1 || height > 6) continue;
    const color = parseColor(styleValue(ctx, el, 'background-color', pseudo));
    if (color && color.a > 0.1 && (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) >= 30)) return true;
  }
  return false;
}

async function overusedFont(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const usage = new Map<string, number>();
  let total = 0;
  for (const el of Array.from(ctx.doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,dd,blockquote,figcaption,a,button,label,span'))) {
    await checkpoint();
    if (el.closest('.impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip')) continue;
    if (!hasDirectText(el)) continue;
    const font = primaryFont(styleValue(ctx, el, 'font-family'), true);
    if (!font) continue;
    usage.set(font, (usage.get(font) ?? 0) + 1);
    total += 1;
  }
  if (total < OVERUSED_FONT_MIN_TEXT_ELEMENTS) return [];
  const ranked = [...usage.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || ranked[1]?.[1] === top[1]) return [];
  if (!OVERUSED_FONTS.has(top[0]) || isBrandFontOnOwnDomain(top[0], ctx.hostname)) return [];
  return [{
    detail: `Primary font: ${top[0]} (${Math.round((top[1] / total) * 100)}% of text)`,
    ignoreValue: top[0],
  }];
}

function hierarchyRole(el: Element): string {
  const tag = tagName(el);
  return HEADING_TAGS.has(tag) ? tag : 'body';
}

async function flatTypeHierarchy(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const byRole = new Map<string, number[]>();
  for (const el of Array.from(ctx.doc.querySelectorAll(TYPE_HIERARCHY_SELECTOR))) {
    await checkpoint();
    if (el.closest(TYPE_HIERARCHY_SKIP_SELECTOR) || !collapseWhitespace(el.textContent ?? '') || !isRendered(ctx, el)) continue;
    const size = parseFontSize(ctx, el);
    if (!Number.isFinite(size) || size < 8 || size >= 200) continue;
    const role = hierarchyRole(el);
    const samples = byRole.get(role) ?? [];
    samples.push(roundTenth(size));
    byRole.set(role, samples);
  }

  const roles: Array<[string, number]> = [];
  for (const [role, samples] of byRole) {
    const counts = new Map<number, number>();
    for (const sample of samples) counts.set(sample, (counts.get(sample) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) continue;
    if (ranked[0]) roles.push([role, ranked[0][0]]);
  }
  if (roles.length < TYPE_HIERARCHY_MIN_ROLES) return [];
  roles.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  let largestStep = 1;
  for (let index = 1; index < roles.length; index += 1) {
    largestStep = Math.max(largestStep, roles[index]![1] / roles[index - 1]![1]);
  }
  if (largestStep >= TYPE_HIERARCHY_MIN_STEP_RATIO) return [];
  const roleSizes = roles.map(([role, size]) => `${role} ${numberText(size)}px`).join(', ');
  return [{
    detail: `Role sizes: ${roleSizes} (largest adjacent step ${largestStep.toFixed(2)}:1; target ${numberText(TYPE_HIERARCHY_MIN_STEP_RATIO)}:1)`,
  }];
}

async function skippedHeading(ctx: ScanContext, checkpoint: Checkpoint): Promise<PageHit[]> {
  const headings = Array.from(ctx.doc.querySelectorAll(HEADING_SELECTOR));
  const hits: PageHit[] = [];
  let previousLevel = 0;
  let previousText = '';
  for (const heading of headings) {
    await checkpoint();
    const level = Number.parseInt(tagName(heading).slice(1), 10);
    const currentText = textSample(heading, 60);
    if (previousLevel > 0 && level > previousLevel + 1) {
      hits.push({
        detail: `<h${previousLevel}> "${previousText}" followed by <h${level}> "${currentText}" (missing h${previousLevel + 1})`,
      });
    }
    previousLevel = level;
    previousText = currentText;
  }
  return hits;
}

function iconTileStack(el: Element, ctx: ScanContext): RuleHit[] {
  const headingTag = tagName(el);
  if (!HEADING_TAGS.has(headingTag)) return [];
  const sibling = el.previousElementSibling;
  if (!sibling || HEADING_TAGS.has(tagName(sibling))) return [];
  const siblingRect = elementRect(ctx, sibling);
  const headingRect = elementRect(ctx, el);
  const width = siblingRect.width;
  const height = siblingRect.height;
  if (width < ICON_TILE_MIN_PX || width > ICON_TILE_MAX_PX || height < ICON_TILE_MIN_PX || height > ICON_TILE_MAX_PX) return [];
  const aspect = width / height;
  if (aspect < ICON_TILE_MIN_ASPECT || aspect > ICON_TILE_MAX_ASPECT) return [];
  const background = parseColor(styleValue(ctx, sibling, 'background-color'));
  const backgroundImage = styleValue(ctx, sibling, 'background-image');
  const borderWidth = parsePx(styleValue(ctx, sibling, 'border-top-width')) ?? 0;
  const radius = parsePx(styleValue(ctx, sibling, 'border-radius')) ?? 0;
  if (!(background && background.a > 0.1) && (!backgroundImage || backgroundImage === 'none') && borderWidth <= 0) return [];
  if (radius >= width / 2) return [];
  const icon = sibling.querySelector('svg, i[data-lucide], i[class*="fa-"], i[class*="icon"]');
  const emojiOnly = sibling.children.length === 0 && /^[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\s]+$/u.test(directText(sibling).trim());
  if (!icon && !emojiOnly) return [];
  if (icon) {
    const iconRect = elementRect(ctx, icon);
    if (iconRect.width > 0 && iconRect.width >= width * 0.95) return [];
  }
  if (siblingRect.hasLayout && headingRect.hasLayout && siblingRect.bottom > headingRect.top + 4) return [];
  return [{ detail: `${Math.round(width)}x${Math.round(height)}px icon tile above ${headingTag} "${textSample(el, 60)}"` }];
}

function italicSerifDisplay(el: Element, ctx: ScanContext): RuleHit[] {
  const tag = tagName(el);
  if (tag !== 'h1' && tag !== 'h2') return [];
  const fontSize = parseFontSize(ctx, el);
  if (styleValue(ctx, el, 'font-style') !== 'italic' || fontSize < ITALIC_SERIF_MIN_PX) return [];
  if (tag === 'h2' && fontSize < ITALIC_SERIF_MIN_PX) return [];
  const family = styleValue(ctx, el, 'font-family');
  const tokens = family.split(',').map((token) => token.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  const primary = tokens.find((token) => token && !GENERIC_FONTS.has(token));
  if (!primary || (!KNOWN_SERIF_FONTS.has(primary) && !tokens.includes('serif'))) return [];
  return [{ detail: `italic serif ${tag} (${primary}) at ${Math.round(fontSize)}px "${textSample(el, 60)}"` }];
}

function heroEyebrowChip(el: Element, ctx: ScanContext): RuleHit[] {
  if (tagName(el) !== 'h1' || parseFontSize(ctx, el) < HERO_HEADING_MIN_PX) return [];
  if (el.closest('[role="tabpanel"], [role="dialog"], [role="application"], dialog')) return [];
  const sibling = el.previousElementSibling;
  if (!sibling || HEADING_TAGS.has(tagName(sibling))) return [];
  const text = collapseWhitespace(sibling.textContent ?? '');
  const fontSize = parseFontSize(ctx, sibling);
  if (text.length < 2 || text.length > 60 || fontSize <= 0 || fontSize > HERO_EYEBROW_MAX_PX) return [];
  const uppercased = styleValue(ctx, sibling, 'text-transform') === 'uppercase' || (/[A-Z]/.test(text) && !/[a-z]/.test(text));
  const trackedCaps = uppercased && parseLetterSpacing(ctx, sibling) >= HERO_EYEBROW_MIN_TRACKING_PX;
  const accentBold = parseFontWeight(ctx, sibling) >= 700 && isAccentColor(styleValue(ctx, sibling, 'color'));
  const dashPrefix = isAccentDashPseudo(ctx, sibling);
  if (!trackedCaps && !accentBold && !dashPrefix) return [];
  const style = trackedCaps ? 'tracked-caps' : accentBold ? 'accent-bold' : 'dash-prefix';
  return [{ detail: `eyebrow chip (${style}) "${text.slice(0, 40)}" above h1 "${textSample(el, 60)}"` }];
}

function hasKickerSkipAncestor(el: Element): boolean {
  try {
    return el.closest(KICKER_SKIP_SELECTOR) !== null;
  } catch {
    return false;
  }
}

function kickerAboveHeading(el: Element, ctx: ScanContext): RuleHit[] {
  const heading = el.nextElementSibling;
  if (!heading || !HEADING_WITH_ARIA_SELECTOR.split(',').some((selector) => heading.matches(selector))) return [];
  const headingTag = tagName(heading);
  const headingLevel = HEADING_TAGS.has(headingTag)
    ? Number.parseInt(headingTag.slice(1), 10)
    : Number.parseInt(heading.getAttribute('aria-level') ?? '2', 10);
  if (!Number.isFinite(headingLevel) || headingLevel > 4 || hasKickerSkipAncestor(heading) || hasKickerSkipAncestor(el)) return [];
  if (heading.closest('[role="tabpanel"], [role="dialog"], [role="application"], dialog')) return [];
  const cardContext = heading.closest(KICKER_CARD_CONTEXT_SELECTOR);
  if (cardContext && cardContext.contains(el)) return [];
  const kickerTag = tagName(el);
  if (HEADING_TAGS.has(kickerTag) || !['p', 'span', 'div', 'small'].includes(kickerTag)) return [];
  const headingText = collapseWhitespace(heading.textContent ?? '');
  const directKickerText = collapseWhitespace(directText(el));
  const kickerText = directKickerText || collapseWhitespace(el.textContent || '');
  if (headingText.length < 3 || kickerText.length < 2 || kickerText.length > 34) return [];
  if (/^\/?[0-9A-Za-z_-]+/.test(kickerText) && kickerText.startsWith('/')) return [];
  if (/^(?:step\s*\d+|\d{1,2})$/i.test(kickerText)) return [];
  if (/[·•|]|\s[\/›»>]\s|\b(?:19|20)\d{2}\b/.test(kickerText)) return [];
  if (/^(?:§|\d+(?:\.\d+)+\b|(?:section|article|clause|appendix|exhibit|schedule|chapter|part|rule|title)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)/i.test(kickerText)) return [];
  const variant = `${styleValue(ctx, el, 'font-variant')} ${styleValue(ctx, el, 'font-variant-caps')}`;
  const uppercased = styleValue(ctx, el, 'text-transform') === 'uppercase' || (/[A-Z]/.test(kickerText) && !/[a-z]/.test(kickerText)) || variant.includes('small-caps');
  const fontSize = parseFontSize(ctx, heading);
  const kickerSize = parseFontSize(ctx, el);
  const tracking = parseLetterSpacing(ctx, el);
  if (fontSize < KICKER_MIN_HEADING_PX || !uppercased || kickerSize <= 0 || kickerSize > KICKER_MAX_PX || trackingEm(tracking, kickerSize) < KICKER_MIN_TRACKING_EM) return [];
  if (headingTag === 'h1' && fontSize >= HERO_HEADING_MIN_PX && tracking >= HERO_EYEBROW_MIN_TRACKING_PX) return [];
  return [{ detail: `kicker "${kickerText.slice(0, 40)}" above ${headingTag} "${headingText.slice(0, 60)}"` }];
}

function designSystemFont(el: Element, ctx: ScanContext): RuleHit[] {
  const configured = ctx.config.designSystem?.fontFamilies;
  if (!configured || configured.length === 0 || !hasDirectText(el) || !isRendered(ctx, el)) return [];
  const font = primaryFont(styleValue(ctx, el, 'font-family'), false);
  if (!font) return [];
  const allowed = configured.map((value) => primaryFont(value, false)).filter(Boolean);
  if (allowed.includes(font)) return [];
  return [{
    detail: `${tagName(el)}${textSample(el) ? ` "${textSample(el)}"` : ''} uses ${font}; not declared in DESIGN.md typography`,
    ignoreValue: font,
  }];
}

function designSystemFontSize(el: Element, ctx: ScanContext): RuleHit[] {
  const configured = ctx.config.designSystem?.fontSizes;
  if (!configured || configured.length === 0 || !hasDirectText(el) || !isRendered(ctx, el)) return [];
  const size = parseFontSize(ctx, el);
  if (size <= 0 || configured.some((allowed) => Math.abs(allowed - size) <= DESIGN_FONT_SIZE_TOLERANCE_PX)) return [];
  const value = `${numberText(size)}px`;
  return [{
    detail: `${value} on ${tagName(el)}${textSample(el) ? ` "${textSample(el)}"` : ''} is outside DESIGN.md type scale`,
    ignoreValue: value,
  }];
}

const pageRule = (id: string, category: 'slop' | 'quality', name: string, description: string, test: PageRule['test'], skillSection?: string): PageRule => ({
  id,
  category,
  name,
  description,
  ...(skillSection === undefined ? {} : { skillSection }),
  scope: 'page',
  test,
});

const elementRule = (id: string, category: 'slop' | 'quality', name: string, description: string, test: ElementRule['test'], skillSection?: string, severity?: 'error' | 'warning' | 'advisory'): ElementRule => ({
  id,
  category,
  ...(severity === undefined ? {} : { severity }),
  name,
  description,
  ...(skillSection === undefined ? {} : { skillSection }),
  scope: 'element',
  test,
});

export const typographyStructureRules: Rule[] = [
  pageRule(
    'overused-font',
    'slop',
    'Overused font',
    'Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.',
    (ctx, checkpoint) => overusedFont(ctx, checkpoint),
    'Typography',
  ),
  pageRule(
    'flat-type-hierarchy',
    'slop',
    'Flat type hierarchy',
    'Dominant heading and body roles are separated by less than 1.25× at every step, leaving the size hierarchy flat. Add at least one stronger size step.',
    (ctx, checkpoint) => flatTypeHierarchy(ctx, checkpoint),
    'Typography',
  ),
  pageRule(
    'skipped-heading',
    'quality',
    'Skipped heading level',
    'Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.',
    (ctx, checkpoint) => skippedHeading(ctx, checkpoint),
  ),
  elementRule(
    'icon-tile-stack',
    'slop',
    'Icon tile stacked above heading',
    'A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.',
    (el, ctx) => iconTileStack(el, ctx),
    'Typography',
  ),
  elementRule(
    'italic-serif-display',
    'slop',
    'Italic serif display headline',
    'Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set roman, or move to a non-serif display face. Editorial / magazine register may legitimately want this — judge by context.',
    (el, ctx) => italicSerifDisplay(el, ctx),
    'Typography',
  ),
  elementRule(
    'hero-eyebrow-chip',
    'slop',
    'Hero eyebrow / pill chip',
    'A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero. Drop the eyebrow, integrate the kicker into the headline, or run it as a navigation breadcrumb instead.',
    (el, ctx) => heroEyebrowChip(el, ctx),
    'Typography',
  ),
  elementRule(
    'kicker-above-heading',
    'slop',
    'Kicker / eyebrow label above heading',
    'A tiny tracked uppercase or small-caps label sitting as its own block directly above a heading is banned outright, repeated or not. Generated kickers never earn their place: the heading carries its own weight. Delete the label and let the heading speak; if the words matter, work them into the heading or the body.',
    (el, ctx) => kickerAboveHeading(el, ctx),
    'Typography',
  ),
  elementRule(
    'design-system-font',
    'quality',
    'Font outside DESIGN.md',
    'A font is used that is not declared in DESIGN.md typography. Use the documented type system or update DESIGN.md if this is an intentional brand addition.',
    (el, ctx) => designSystemFont(el, ctx),
    'Typography',
  ),
  elementRule(
    'design-system-font-size',
    'quality',
    'Font size outside DESIGN.md',
    'A literal font-size is off the type ramp documented in DESIGN.md typography. Use a documented size step or update the design system if the new step is intentional.',
    (el, ctx) => designSystemFontSize(el, ctx),
    'Typography',
    'advisory',
  ),
];
