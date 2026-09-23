// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { typographyStructureRules } from './typography-structure';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

async function scan(config: Parameters<typeof createScanContext>[1] = {}) {
  return await collectFindings(typographyStructureRules, createScanContext(window, config), new AbortController().signal);
}

async function ruleFindings(ruleId: string, config: Parameters<typeof createScanContext>[1] = {}) {
  return (await scan(config)).filter((finding) => finding.ruleId === ruleId);
}

async function firstRuleFinding(ruleId: string, config: Parameters<typeof createScanContext>[1] = {}) {
  return (await ruleFindings(ruleId, config))[0];
}

beforeEach(resetDocument);

describe('typography-structure lint rules through the real engine', () => {
  it('exports all nine rules with faithful metadata and scopes', () => {
    expect(typographyStructureRules.map((rule) => rule.id)).toEqual([
      'overused-font',
      'flat-type-hierarchy',
      'skipped-heading',
      'icon-tile-stack',
      'italic-serif-display',
      'hero-eyebrow-chip',
      'kicker-above-heading',
      'design-system-font',
      'design-system-font-size',
    ]);
    expect(typographyStructureRules.filter((rule) => rule.scope === 'page').map((rule) => rule.id)).toEqual([
      'overused-font',
      'flat-type-hierarchy',
      'skipped-heading',
    ]);
    expect(typographyStructureRules.filter((rule) => rule.scope === 'element').map((rule) => rule.id)).toEqual([
      'icon-tile-stack',
      'italic-serif-display',
      'hero-eyebrow-chip',
      'kicker-above-heading',
      'design-system-font',
      'design-system-font-size',
    ]);

    expect(typographyStructureRules.find((rule) => rule.id === 'overused-font')).toMatchObject({
      category: 'slop',
      name: 'Overused font',
      description: 'Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'flat-type-hierarchy')).toMatchObject({
      category: 'slop',
      name: 'Flat type hierarchy',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'skipped-heading')).toMatchObject({
      category: 'quality',
      name: 'Skipped heading level',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'skipped-heading')).not.toHaveProperty('skillSection');
    expect(typographyStructureRules.find((rule) => rule.id === 'icon-tile-stack')).toMatchObject({
      category: 'slop',
      name: 'Icon tile stacked above heading',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'italic-serif-display')).toMatchObject({
      category: 'slop',
      name: 'Italic serif display headline',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'hero-eyebrow-chip')).toMatchObject({
      category: 'slop',
      name: 'Hero eyebrow / pill chip',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'kicker-above-heading')).toMatchObject({
      category: 'slop',
      name: 'Kicker / eyebrow label above heading',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'design-system-font')).toMatchObject({
      category: 'quality',
      name: 'Font outside DESIGN.md',
      skillSection: 'Typography',
    });
    expect(typographyStructureRules.find((rule) => rule.id === 'design-system-font-size')).toMatchObject({
      category: 'quality',
      severity: 'advisory',
      name: 'Font size outside DESIGN.md',
      description: 'A literal font-size is off the type ramp documented in DESIGN.md typography. Use a documented size step or update the design system if the new step is intentional.',
      skillSection: 'Typography',
    });
  });

  it('flags a uniquely dominant overused font and accepts a page below the 20-element floor', async () => {
    document.body.innerHTML = Array.from({ length: 20 }, (_, index) =>
      `<p style="font-family: Inter, sans-serif">Text ${index}</p>`,
    ).join('');
    expect(await firstRuleFinding('overused-font')).toMatchObject({
      ruleId: 'overused-font',
      detail: 'Primary font: inter (100% of text)',
    });

    document.body.innerHTML = Array.from({ length: 19 }, (_, index) =>
      `<p style="font-family: Inter, sans-serif">Text ${index}</p>`,
    ).join('');
    expect(await ruleFindings('overused-font')).toHaveLength(0);
  });

  it('flags a flat hierarchy below the 1.25 ratio and accepts a clear adjacent step', async () => {
    document.body.innerHTML = `
      <p style="font-size: 16px">Body</p>
      <h2 style="font-size: 17px">Section</h2>
      <h1 style="font-size: 18px">Title</h1>
    `;
    expect(await firstRuleFinding('flat-type-hierarchy')).toMatchObject({
      ruleId: 'flat-type-hierarchy',
      detail: 'Role sizes: body 16px, h2 17px, h1 18px (largest adjacent step 1.06:1; target 1.25:1)',
    });

    document.body.innerHTML = `
      <p style="font-size: 16px">Body</p>
      <h2 style="font-size: 24px">Section</h2>
      <h1 style="font-size: 40px">Title</h1>
    `;
    expect(await ruleFindings('flat-type-hierarchy')).toHaveLength(0);
  });

  it('flags an h1 to h3 gap and accepts an h1 to h2 sequence', async () => {
    document.body.innerHTML = '<h1>Title here</h1><h3>Subsection</h3>';
    expect(await firstRuleFinding('skipped-heading')).toMatchObject({
      ruleId: 'skipped-heading',
      detail: '<h1> "Title here" followed by <h3> "Subsection" (missing h2)',
    });

    document.body.innerHTML = '<h1>Title here</h1><h2>Subsection</h2>';
    expect(await ruleFindings('skipped-heading')).toHaveLength(0);
  });

  it('flags a rounded icon tile above a heading and accepts a pill-shaped tile', async () => {
    document.body.innerHTML = `
      <div id="tile" style="width: 64px; height: 64px; background-color: rgb(245, 245, 245); border-radius: 12px"><svg style="width: 24px; height: 24px"></svg></div>
      <h2 style="font-size: 24px">Feature heading</h2>
    `;
    expect(await firstRuleFinding('icon-tile-stack')).toMatchObject({
      ruleId: 'icon-tile-stack',
      detail: '64x64px icon tile above h2 "Feature heading"',
    });

    document.querySelector('#tile')!.setAttribute(
      'style',
      'width: 64px; height: 64px; background-color: rgb(245, 245, 245); border-radius: 32px',
    );
    expect(await ruleFindings('icon-tile-stack')).toHaveLength(0);
  });

  it('flags an italic serif display headline and accepts the 47px boundary', async () => {
    document.body.innerHTML = '<h1 style="font: italic 48px Georgia">Editorial headline</h1>';
    expect(await firstRuleFinding('italic-serif-display')).toMatchObject({
      ruleId: 'italic-serif-display',
      detail: 'italic serif h1 (georgia) at 48px "Editorial headline"',
    });

    document.body.innerHTML = '<h1 style="font: italic 47px Georgia">Editorial headline</h1>';
    expect(await ruleFindings('italic-serif-display')).toHaveLength(0);
  });

  it('flags a tracked uppercase hero eyebrow and accepts tracking below 1.6px', async () => {
    document.body.innerHTML = `
      <p style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase">Our studio</p>
      <h1 style="font-size: 48px">A considered headline</h1>
    `;
    expect(await firstRuleFinding('hero-eyebrow-chip')).toMatchObject({
      ruleId: 'hero-eyebrow-chip',
      detail: 'eyebrow chip (tracked-caps) "Our studio" above h1 "A considered headline"',
    });

    document.querySelector('p')!.style.letterSpacing = '1.5px';
    expect(await ruleFindings('hero-eyebrow-chip')).toHaveLength(0);
  });

  it('flags a tracked uppercase kicker above a heading and accepts the 0.06em boundary', async () => {
    document.body.innerHTML = `
      <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase">Features</p>
      <h2 style="font-size: 32px">Everything you need</h2>
    `;
    expect(await firstRuleFinding('kicker-above-heading')).toMatchObject({
      ruleId: 'kicker-above-heading',
      detail: 'kicker "Features" above h2 "Everything you need"',
    });

    document.querySelector('p')!.style.letterSpacing = '0.71px';
    expect(await ruleFindings('kicker-above-heading')).toHaveLength(0);
  });

  it('keeps design-system font inert without config and flags an undeclared family with config', async () => {
    document.body.innerHTML = '<p style="font-family: Arial, sans-serif">Target</p>';
    expect(await ruleFindings('design-system-font')).toHaveLength(0);

    const finding = await firstRuleFinding('design-system-font', {
      designSystem: { fontFamilies: ['Inter'] },
    });
    expect(finding).toMatchObject({
      ruleId: 'design-system-font',
      detail: 'p "Target" uses arial; not declared in DESIGN.md typography',
      ignoreValue: 'arial',
    });
  });

  it('keeps design-system font size inert without config and flags an off-scale size with config', async () => {
    document.body.innerHTML = '<p style="font-size: 18px">Target</p>';
    expect(await ruleFindings('design-system-font-size')).toHaveLength(0);

    const finding = await firstRuleFinding('design-system-font-size', {
      designSystem: { fontSizes: [16, 24] },
    });
    expect(finding).toMatchObject({
      ruleId: 'design-system-font-size',
      detail: '18px on p "Target" is outside DESIGN.md type scale',
      ignoreValue: '18px',
      severity: 'advisory',
    });
  });

  it('reports kicker-above-heading at advisory severity', async () => {
    document.body.innerHTML = `
      <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase">Features</p>
      <h2 style="font-size: 32px">Everything you need</h2>
    `;
    expect(await firstRuleFinding('kicker-above-heading')).toMatchObject({ severity: 'advisory', advisory: true });
  });
});
