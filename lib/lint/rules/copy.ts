import type { PageHit, PageRule, Rule, ScanContext } from '../engine';

const EM_DASH_FLOOR = 8;
const EM_DASH_CHARS_PER_DASH = 500;
const BUZZWORD_SAMPLE_CONTEXT = 12;
const APHORISTIC_MIN_COUNT = 3;
const APHORISTIC_SAMPLE_MAX = 80;

const EM_DASH_RE = /—|--(?=\S)/g;
const BUZZWORDS = [
  'streamline your',
  'empower your',
  'supercharge your',
  'unleash your',
  'unleash the power',
  'leverage the power',
  'built for the modern',
  'trusted by leading',
  'trusted by the world',
  'best-in-class',
  'industry-leading',
  'world-class',
  'enterprise-grade',
  'next-generation',
  'cutting-edge',
  'transform your business',
  'revolutionize',
  'game-changer',
  'game changing',
  'mission-critical',
  'best of breed',
  'future-proof',
  'future proof',
  'seamless experience',
  'seamlessly integrate',
  'drive engagement',
  'drive growth',
  'drive results',
  'harness the power',
];
const NOT_A_RE = /\bNot an? [a-z][^.!?]{1,40}[.!]\s+[A-Z][^.!?]{1,60}[.!]/g;
const SHORT_REBUTTAL_RE = /\b[A-Z][^.!?]{4,80}[.!]\s+(?:No|Just)\s+[a-z][^.!?]{2,60}[.!]/g;
const THEATER_RE = /\b\w+\s+theater\b/i;

const bodyTexts = new WeakMap<ScanContext, string>();

// Browser path of checkEmDashOveruseDOM: body innerText when non-empty, else textContent, whitespace collapsed.
function bodyText(ctx: ScanContext): string {
  const cached = bodyTexts.get(ctx);
  if (cached !== undefined) return cached;
  const body = ctx.doc.body;
  const raw = body ? body.innerText || body.textContent || '' : '';
  const text = raw.replace(/\s+/g, ' ');
  bodyTexts.set(ctx, text);
  return text;
}

function emDashOveruse(ctx: ScanContext): PageHit[] {
  const text = bodyText(ctx);
  const count = text.match(EM_DASH_RE)?.length ?? 0;
  if (count < EM_DASH_FLOOR) return [];
  if (text.length > count * EM_DASH_CHARS_PER_DASH) return [];
  return [{ detail: `${count} em-dashes in body text` }];
}

function marketingBuzzword(ctx: ScanContext): PageHit[] {
  const text = bodyText(ctx);
  const lower = text.toLowerCase();
  let count = 0;
  let sample = '';
  for (const phrase of BUZZWORDS) {
    for (let idx = lower.indexOf(phrase); idx !== -1; idx = lower.indexOf(phrase, idx + phrase.length)) {
      count += 1;
      if (!sample) {
        const start = Math.max(0, idx - BUZZWORD_SAMPLE_CONTEXT);
        const end = Math.min(text.length, idx + phrase.length + BUZZWORD_SAMPLE_CONTEXT);
        sample = text.slice(start, end).trim();
      }
    }
  }
  if (count === 0) return [];
  return [{ detail: `${count} buzzword phrase${count === 1 ? '' : 's'}: "${sample}"` }];
}

function aphoristicCadence(ctx: ScanContext): PageHit[] {
  const text = bodyText(ctx);
  const matches = [...text.matchAll(NOT_A_RE), ...text.matchAll(SHORT_REBUTTAL_RE)];
  if (matches.length < APHORISTIC_MIN_COUNT) return [];
  const sample = (matches[0]?.[0] ?? '').trim().slice(0, APHORISTIC_SAMPLE_MAX);
  return [{ detail: `${matches.length} aphoristic constructions: "${sample}"` }];
}

function theaterSlopPhrase(ctx: ScanContext): PageHit[] {
  const match = THEATER_RE.exec(bodyText(ctx));
  return match ? [{ detail: `"${match[0].trim()}"` }] : [];
}

const emDashOveruseRule: PageRule = {
  id: 'em-dash-overuse',
  category: 'slop',
  severity: 'advisory',
  name: 'Em-dash overuse',
  description:
    'Em-dash saturation in body copy is an AI cadence tell. Advisory only: humans use em-dashes legitimately, so this fires only on saturation — at least 8 em-dashes (— or --) at a density near one per 500 characters of body text — never on a long article that uses a few. Prefer commas, colons, periods, or parentheses.',
  skillSection: 'Copy',
  scope: 'page',
  test: emDashOveruse,
};

const marketingBuzzwordRule: PageRule = {
  id: 'marketing-buzzword',
  category: 'slop',
  name: 'Marketing buzzword',
  description:
    'Generic SaaS phrases (streamline / empower / supercharge / world-class / enterprise-grade / next-generation / cutting-edge / etc) are instant AI tells. Pick a specific verb and noun that says what the product literally does.',
  skillSection: 'Copy',
  scope: 'page',
  test: marketingBuzzword,
};

const aphoristicCadenceRule: PageRule = {
  id: 'aphoristic-cadence',
  category: 'slop',
  name: 'Aphoristic-cadence copy',
  description:
    'Three or more sections landing on a short rebuttal sentence ("X. No Y." / "X. Just Y.") or a manufactured-contrast aphorism ("Not a feature. A platform.") reads as AI cadence, not voice. Once is fine; the pattern is the tell.',
  skillSection: 'Copy',
  scope: 'page',
  test: aphoristicCadence,
};

const theaterSlopPhraseRule: PageRule = {
  id: 'theater-slop-phrase',
  category: 'slop',
  severity: 'advisory',
  name: 'Theater framing copy',
  description:
    'Dismissing something as "theater" is a recurring generated-copy tic. Say plainly what the thing does or does not do.',
  skillSection: 'Copy',
  scope: 'page',
  test: theaterSlopPhrase,
};

export const copyRules: Rule[] = [emDashOveruseRule, marketingBuzzwordRule, aphoristicCadenceRule, theaterSlopPhraseRule];
