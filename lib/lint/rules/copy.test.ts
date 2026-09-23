// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { copyRules } from './copy';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

// happy-dom has no layout, so its innerText does not match a browser's rendered text.
function setBodyText(text: string, innerText: string = text): void {
  document.body.textContent = text;
  Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => innerText });
}

async function ruleFindings(ruleId: string) {
  return (await collectFindings(copyRules, createScanContext(window), new AbortController().signal)).filter((finding) => finding.ruleId === ruleId);
}

beforeEach(resetDocument);
afterEach(() => {
  Reflect.deleteProperty(document.body, 'innerText');
});

describe('copy lint rules through the real engine', () => {
  it('exports the four rules in registry order with faithful metadata', () => {
    expect(
      copyRules.map(({ id, category, severity, name, skillSection, scope }) => ({
        id,
        category,
        severity,
        name,
        skillSection,
        scope,
      })),
    ).toEqual([
      { id: 'em-dash-overuse', category: 'slop', severity: 'advisory', name: 'Em-dash overuse', skillSection: 'Copy', scope: 'page' },
      { id: 'marketing-buzzword', category: 'slop', severity: undefined, name: 'Marketing buzzword', skillSection: 'Copy', scope: 'page' },
      { id: 'aphoristic-cadence', category: 'slop', severity: undefined, name: 'Aphoristic-cadence copy', skillSection: 'Copy', scope: 'page' },
      { id: 'theater-slop-phrase', category: 'slop', severity: 'advisory', name: 'Theater framing copy', skillSection: 'Copy', scope: 'page' },
    ]);
    expect(copyRules[3]?.description).toBe(
      'Dismissing something as "theater" is a recurring generated-copy tic. Say plainly what the thing does or does not do.',
    );
  });

  it('flags em-dash saturation at the floor of 8, counting -- only before non-space', async () => {
    setBodyText('a—b—c—d—e—f—g --h i\n\n--j and -- k');
    const findings = await ruleFindings('em-dash-overuse');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ detail: '8 em-dashes in body text', severity: 'advisory', advisory: true });
    expect(findings[0]?.ignoreValue).toBeUndefined();
  });

  it('does not flag 7 em-dashes, or 8 spread thinner than one per 500 characters', async () => {
    setBodyText('a—b—c—d—e—f—g—h -- i');
    expect(await ruleFindings('em-dash-overuse')).toEqual([]);

    const dashes = '—'.repeat(8);
    setBodyText(dashes + 'x'.repeat(4000 - 8));
    expect(await ruleFindings('em-dash-overuse')).toHaveLength(1);
    setBodyText(dashes + 'x'.repeat(4001 - 8));
    expect(await ruleFindings('em-dash-overuse')).toEqual([]);
  });

  it('reads rendered innerText, falling back to textContent when innerText is empty', async () => {
    const dashes = 'a—'.repeat(8);
    setBodyText(dashes, 'visible text only');
    expect(await ruleFindings('em-dash-overuse')).toEqual([]);
    setBodyText(dashes, '');
    expect((await ruleFindings('em-dash-overuse'))[0]?.detail).toBe('8 em-dashes in body text');
  });

  it('flags buzzword phrases with a count and a sample around the first listed phrase', async () => {
    setBodyText('We  World-Class teams streamline your workflow.');
    const findings = await ruleFindings('marketing-buzzword');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      detail: '2 buzzword phrases: "Class teams streamline your workflow."',
      severity: 'warning',
    });
    expect(findings[0]?.ignoreValue).toBeUndefined();

    setBodyText('Our cutting-edge lab.');
    expect((await ruleFindings('marketing-buzzword'))[0]?.detail).toBe('1 buzzword phrase: "Our cutting-edge lab."');
  });

  it('does not flag near-miss buzzword wording', async () => {
    setBodyText('We streamline the workflow for world class teams with a next generation cutting edge.');
    expect(await ruleFindings('marketing-buzzword')).toEqual([]);
  });

  it('flags three aphoristic constructions', async () => {
    setBodyText('Not a tool. A platform. Not a feature! A system. Fast deploys ship. No waiting around.');
    const findings = await ruleFindings('aphoristic-cadence');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      detail: '3 aphoristic constructions: "Not a tool. A platform."',
      severity: 'warning',
    });
    expect(findings[0]?.ignoreValue).toBeUndefined();
  });

  it('does not flag two aphoristic constructions or case near-misses', async () => {
    setBodyText('Not a tool. A platform. Fast deploys ship. No waiting around. not a feature. A system. Fast. No waiting.');
    expect(await ruleFindings('aphoristic-cadence')).toEqual([]);
  });

  it('flags "X theater" framing with the first match as detail', async () => {
    setBodyText('This is security\n Theater at best, and compliance theater too.');
    const findings = await ruleFindings('theater-slop-phrase');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ detail: '"security Theater"', severity: 'advisory', advisory: true });
    expect(findings[0]?.ignoreValue).toBeUndefined();
  });

  it('does not flag theater without a preceding word or as a word prefix', async () => {
    setBodyText('Theater tickets: theatergoers love the theaters.');
    expect(await ruleFindings('theater-slop-phrase')).toEqual([]);
  });

  it('honors disabledRules through the engine', async () => {
    setBodyText('This is security theater.');
    const ctx = createScanContext(window, { disabledRules: ['theater-slop-phrase'] });
    expect(await collectFindings(copyRules, ctx, new AbortController().signal)).toEqual([]);
  });
});
