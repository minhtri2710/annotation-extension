// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { typographySizeRules } from './typography-size';

function scan(markup: string) {
  document.body.innerHTML = markup;
  return collectFindings(typographySizeRules, createScanContext(window));
}

function expectFinding(markup: string, ruleId: string, detail: string): void {
  const finding = scan(markup).find((candidate) => candidate.ruleId === ruleId);
  expect(finding).toMatchObject({ ruleId, detail });
}

function expectNoFinding(markup: string, ruleId: string): void {
  expect(scan(markup).some((finding) => finding.ruleId === ruleId)).toBe(false);
}

describe('typography-size lint rules', () => {
  it('exports the eight registered rules with faithful metadata', () => {
    expect(typographySizeRules.map((rule) => rule.id)).toEqual([
      'tiny-text',
      'undersized-ui-text',
      'all-caps-body',
      'wide-tracking',
      'extreme-negative-tracking',
      'tight-leading',
      'justified-text',
      'oversized-h1',
    ]);
    expect(typographySizeRules.every((rule) => rule.scope === 'element')).toBe(true);
    expect(typographySizeRules.find((rule) => rule.id === 'tiny-text')).toMatchObject({
      category: 'quality',
      name: 'Tiny body text',
      description: 'Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'undersized-ui-text')).toMatchObject({
      category: 'quality',
      name: 'Undersized functional text',
      description: expect.stringContaining('The 11px floor holds even inside a footer'),
    });
    expect(typographySizeRules.find((rule) => rule.id === 'all-caps-body')).toMatchObject({
      category: 'quality',
      name: 'All-caps body text',
      skillSection: 'Typography',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'wide-tracking')).toMatchObject({
      category: 'quality',
      name: 'Wide letter spacing on body text',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'extreme-negative-tracking')).toMatchObject({
      category: 'slop',
      name: 'Crushed letter spacing',
      skillSection: 'Typography',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'tight-leading')).toMatchObject({
      category: 'quality',
      name: 'Tight line height',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'tight-leading')).not.toHaveProperty('skillSection');
    expect(typographySizeRules.find((rule) => rule.id === 'justified-text')).toMatchObject({
      category: 'quality',
      name: 'Justified text',
    });
    expect(typographySizeRules.find((rule) => rule.id === 'justified-text')).not.toHaveProperty('skillSection');
    expect(typographySizeRules.find((rule) => rule.id === 'oversized-h1')).toMatchObject({
      category: 'slop',
      name: 'Oversized hero headline',
      skillSection: 'Typography',
    });
  });

  it('detects tiny body text but accepts the 12px boundary', () => {
    expectFinding(
      '<p style="font-size: 10px">This is small body copy text.</p>',
      'tiny-text',
      '10px body text',
    );
    expectNoFinding(
      '<p style="font-size: 12px">This is readable body copy text.</p>',
      'tiny-text',
    );
  });

  it('detects undersized UI text but accepts the 11px boundary', () => {
    expectFinding(
      '<span style="font-size: 9px">Meta 12:00</span>',
      'undersized-ui-text',
      '9px functional text "Meta 12:00" (below 11px floor)',
    );
    expectNoFinding('<span style="font-size: 11px">Meta 12:00</span>', 'undersized-ui-text');
  });

  it('detects long all-caps body text but accepts 30 characters', () => {
    expectFinding(
      `<p style="text-transform: uppercase">${'A'.repeat(31)}</p>`,
      'all-caps-body',
      'text-transform: uppercase on 31 chars of body text',
    );
    expectNoFinding(`<p style="text-transform: uppercase">${'A'.repeat(30)}</p>`, 'all-caps-body');
  });

  it('detects wide tracking but accepts exactly 0.05em', () => {
    expectFinding(
      '<p style="font-size: 16px; letter-spacing: 2px">This body copy has wide tracking.</p>',
      'wide-tracking',
      'letter-spacing: 0.13em on body text',
    );
    expectNoFinding(
      '<p style="font-size: 16px; letter-spacing: 0.8px">This body copy has normal tracking.</p>',
      'wide-tracking',
    );
  });

  it('detects extreme negative tracking at -0.05em and below only', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expectFinding(
      `<p style="font-size: 16px; letter-spacing: -0.8px">${text}</p>`,
      'extreme-negative-tracking',
      'letter-spacing: -0.05em — "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    );
    expectNoFinding(
      `<p style="font-size: 16px; letter-spacing: -0.64px">${text}</p>`,
      'extreme-negative-tracking',
    );
  });

  it('detects tight leading below 1.3 and accepts exactly 1.3', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expectFinding(
      `<p style="font-size: 16px; line-height: 20.64px">${text}</p>`,
      'tight-leading',
      'line-height 1.29x (need >=1.3)',
    );
    expectNoFinding(
      `<p style="font-size: 16px; line-height: 20.8px">${text}</p>`,
      'tight-leading',
    );
  });

  it('detects unjustified text without hyphenation but accepts hyphens:auto', () => {
    const text = 'This paragraph is long enough to carry a direct text quality signal.';
    expectFinding(
      `<p style="text-align: justify; hyphens: manual">${text}</p>`,
      'justified-text',
      'text-align: justify without hyphens: auto',
    );
    expectNoFinding(
      `<p style="text-align: justify; hyphens: auto">${text}</p>`,
      'justified-text',
    );
  });

  it('detects a long h1 at the 72px display threshold and accepts 71px', () => {
    const headline = 'This is a full sentence headline that dominates the viewport';
    expectFinding(
      `<h1 style="font-size: 72px">${headline}</h1>`,
      'oversized-h1',
      `72px h1, ${headline.length} chars "${headline}"`,
    );
    expectNoFinding(
      `<h1 style="font-size: 71px">${headline}</h1>`,
      'oversized-h1',
    );
  });
});
