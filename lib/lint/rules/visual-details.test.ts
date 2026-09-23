// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { visualDetailsRules } from './visual-details';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

function scan(markup: string, config = {}, style = '') {
  document.querySelectorAll('style').forEach((sheet) => sheet.remove());
  document.body.innerHTML = markup;
  if (style) {
    const sheet = document.createElement('style');
    sheet.textContent = style;
    document.head.appendChild(sheet);
  }
  return collectFindings(visualDetailsRules, createScanContext(window, config));
}

function ruleFindings(markup: string, ruleId: string, config = {}, style = '') {
  return scan(markup, config, style).filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

beforeEach(resetDocument);
afterEach(() => vi.restoreAllMocks());

describe('visual-details lint rules through the real engine', () => {
  it('exports the six visual-details rules in registry order with faithful metadata', () => {
    expect(visualDetailsRules.map((rule) => rule.id)).toEqual([
      'side-tab',
      'border-accent-on-rounded',
      'design-system-radius',
      'gpt-thin-border-wide-shadow',
      'repeating-stripes-gradient',
      'codex-grid-background',
    ]);
    expect(visualDetailsRules.find((rule) => rule.id === 'side-tab')).toMatchObject({
      category: 'slop',
      name: 'Side-tab accent border',
      description: 'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
      skillSection: 'Visual Details',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'border-accent-on-rounded')).toMatchObject({
      category: 'slop',
      name: 'Border accent on rounded element',
      description: 'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
      skillSection: 'Visual Details',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'design-system-radius')).toMatchObject({
      category: 'quality',
      severity: 'advisory',
      name: 'Radius outside DESIGN.md',
      description: 'A border-radius value is outside the DESIGN.md rounded scale. Use a documented radius token or update the design system if the new shape is intentional.',
      skillSection: 'Visual Details',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'gpt-thin-border-wide-shadow')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Hairline border with wide shadow',
      description: 'A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.',
      skillSection: 'Visual Details',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'repeating-stripes-gradient')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Repeating-gradient stripes',
      description: 'Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.',
      skillSection: 'Visual Details',
      scope: 'page',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'codex-grid-background')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Decorative grid-line background',
      description: 'A decorative grid or line-field background drawn with hairline linear-gradient layers tiled by a fixed pixel cell is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.',
      skillSection: 'Visual Details',
      scope: 'page',
    });
  });

  it('detects a chromatic side stripe, inset shadow stripe, and rejects near-threshold stripes', () => {
    document.body.innerHTML = '<div id="positive" style="border-left: 4px solid rgb(0, 128, 255)"></div>';
    const positiveElement = document.querySelector('#positive') as HTMLElement;
    vi.spyOn(positiveElement, 'getBoundingClientRect').mockReturnValue({
      width: 80,
      height: 40,
      top: 0,
      right: 80,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const positive = collectFindings(visualDetailsRules, createScanContext(window))
      .filter((finding) => finding.ruleId === 'side-tab');
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'side-tab',
      detail: 'border-left: 4px',
    });

    document.body.innerHTML = '<div id="negative" style="border-left: 2px solid rgb(0, 128, 255)"></div>';
    const negativeElement = document.querySelector('#negative') as HTMLElement;
    vi.spyOn(negativeElement, 'getBoundingClientRect').mockReturnValue({
      width: 80,
      height: 40,
      top: 0,
      right: 80,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    expect(collectFindings(visualDetailsRules, createScanContext(window))
      .filter((finding) => finding.ruleId === 'side-tab')).toHaveLength(0);

    document.body.innerHTML = '<div class="card"></div>';
    const insetPositive = ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      {},
      '.card { width: 80px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(insetPositive).toHaveLength(1);
    expect(first(insetPositive)).toMatchObject({
      ruleId: 'side-tab',
      detail: '.card — inset box-shadow 4px stripe (left)',
    });

    const insetNegative = ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      {},
      '.card { width: 80px; box-shadow: inset 2.9px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(insetNegative).toHaveLength(0);
  });

  it('skips inset stripes on boxes declared 40px wide or narrower and fires above the gate', () => {
    const narrow = ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      {},
      '.card { width: 40px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(narrow).toHaveLength(0);

    const wide = ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      {},
      '.card { width: 41px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(wide).toHaveLength(1);
    expect(first(wide)).toMatchObject({
      ruleId: 'side-tab',
      detail: '.card — inset box-shadow 4px stripe (left)',
    });
  });

  it('parses inset-shadow candidates once for many matching elements', () => {
    document.body.innerHTML = '<div class="card"></div><div class="card"></div><div class="card"></div><div class="card"></div>';
    const sheet = document.createElement('style');
    sheet.textContent = '.card { width: 80px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }';
    document.head.appendChild(sheet);
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll');

    const findings = collectFindings(visualDetailsRules, createScanContext(window))
      .filter((finding) => finding.ruleId === 'side-tab');
    expect(findings).toHaveLength(4);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === 'style' || selector === '[style]')).toHaveLength(2);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === 'style')).toHaveLength(1);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === '[style]')).toHaveLength(1);
  });

  it('detects an accent top border on a rounded element and rejects 1.5px', () => {
    document.body.innerHTML = '<div style="border-top: 2px solid rgb(0, 128, 255); border-radius: 8px"></div>';
    vi.spyOn(document.querySelector('div')!, 'getBoundingClientRect').mockReturnValue({
      width: 80,
      height: 40,
      top: 0,
      right: 80,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const positive = collectFindings(visualDetailsRules, createScanContext(window))
      .filter((finding) => finding.ruleId === 'border-accent-on-rounded');
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'border-accent-on-rounded',
      detail: 'border-top: 2px + border-radius: 8px',
    });

    const negative = ruleFindings(
      '<div style="border-top: 1.5px solid rgb(0, 128, 255); border-radius: 8px"></div>',
      'border-accent-on-rounded',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a thin multi-side border with a 16px shadow and rejects 15.9px', () => {
    const positive = ruleFindings(
      '<div style="border-top: 1px solid rgba(0, 0, 0, 0.5); border-left: 1px solid rgba(0, 0, 0, 0.5); box-shadow: 0 0 16px rgba(0, 0, 0, 0.2)"></div>',
      'gpt-thin-border-wide-shadow',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'gpt-thin-border-wide-shadow',
      severity: 'advisory',
      detail: '1px border + 16px shadow blur',
    });

    const negative = ruleFindings(
      '<div style="border-top: 1px solid rgba(0, 0, 0, 0.5); border-left: 1px solid rgba(0, 0, 0, 0.5); box-shadow: 0 0 15.9px rgba(0, 0, 0, 0.2)"></div>',
      'gpt-thin-border-wide-shadow',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects repeating gradient stripes and rejects a non-repeating gradient', () => {
    const positive = ruleFindings(
      '<div></div>',
      'repeating-stripes-gradient',
      {},
      '.stripe { background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 2px); }',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'repeating-stripes-gradient',
      severity: 'advisory',
      detail: 'repeating-gradient decorative stripes',
    });

    const negative = ruleFindings(
      '<div></div>',
      'repeating-stripes-gradient',
      {},
      '.stripe { background-image: linear-gradient(45deg, #fff, transparent); }',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a two-axis hairline grid and rejects a single hairline', () => {
    const positive = ruleFindings(
      '<div></div>',
      'codex-grid-background',
      {},
      '.grid { background-image: linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px); background-size: 20px 20px; }',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'codex-grid-background',
      severity: 'advisory',
      detail: 'two-axis grid-line gradient background',
    });

    const negative = ruleFindings(
      '<div></div>',
      'codex-grid-background',
      {},
      '.grid { background-image: linear-gradient(to right, #000 1px, transparent 1px); background-size: 20px 20px; }',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a radius outside the configured scale, carries ignoreValue, and is inert without config', () => {
    const positive = ruleFindings(
      '<div style="border-radius: 10px"></div>',
      'design-system-radius',
      { designSystem: { radii: [8] } },
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'design-system-radius',
      severity: 'advisory',
      detail: 'border-radius 10px on div is outside the DESIGN.md rounded scale',
      ignoreValue: '10px',
    });

    const negative = ruleFindings(
      '<div style="border-radius: 8px"></div>',
      'design-system-radius',
      { designSystem: { radii: [8] } },
    );
    expect(negative).toHaveLength(0);
    expect(ruleFindings('<div style="border-radius: 10px"></div>', 'design-system-radius')).toHaveLength(0);
  });
});
