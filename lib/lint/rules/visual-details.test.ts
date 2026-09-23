// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { visualDetailsRules } from './visual-details';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

async function scan(markup: string, style = '') {
  document.querySelectorAll('style').forEach((sheet) => sheet.remove());
  document.body.innerHTML = markup;
  if (style) {
    const sheet = document.createElement('style');
    sheet.textContent = style;
    document.head.appendChild(sheet);
  }
  return await collectFindings(visualDetailsRules, createScanContext(window), new AbortController().signal);
}

async function ruleFindings(markup: string, ruleId: string, style = '') {
  return (await scan(markup, style)).filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

beforeEach(resetDocument);
afterEach(() => vi.restoreAllMocks());

describe('visual-details lint rules through the real engine', () => {
  it('exports the five visual-details rules in registry order with faithful metadata', () => {
    expect(visualDetailsRules.map((rule) => rule.id)).toEqual([
      'side-tab',
      'border-accent-on-rounded',
      'gpt-thin-border-wide-shadow',
      'repeating-stripes-gradient',
      'codex-grid-background',
    ]);
    expect(visualDetailsRules.find((rule) => rule.id === 'side-tab')).toMatchObject({
      category: 'slop',
      name: 'Side-tab accent border',
      description: 'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'border-accent-on-rounded')).toMatchObject({
      category: 'slop',
      name: 'Border accent on rounded element',
      description: 'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'gpt-thin-border-wide-shadow')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Hairline border with wide shadow',
      description: 'A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.',
      scope: 'element',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'repeating-stripes-gradient')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Repeating-gradient stripes',
      description: 'Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.',
      scope: 'page',
    });
    expect(visualDetailsRules.find((rule) => rule.id === 'codex-grid-background')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Decorative grid-line background',
      description: 'A decorative grid or line-field background drawn with hairline linear-gradient layers tiled by a fixed pixel cell is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.',
      scope: 'page',
    });
  });

  it('detects a chromatic side stripe, inset shadow stripe, and rejects near-threshold stripes', async () => {
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
    const positive = (await collectFindings(visualDetailsRules, createScanContext(window), new AbortController().signal))
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
    expect((await collectFindings(visualDetailsRules, createScanContext(window), new AbortController().signal))
      .filter((finding) => finding.ruleId === 'side-tab')).toHaveLength(0);

    document.body.innerHTML = '<div class="card"></div>';
    const insetPositive = await ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      '.card { width: 80px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(insetPositive).toHaveLength(1);
    expect(first(insetPositive)).toMatchObject({
      ruleId: 'side-tab',
      detail: '.card — inset box-shadow 4px stripe (left)',
    });

    const insetNegative = await ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      '.card { width: 80px; box-shadow: inset 2.9px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(insetNegative).toHaveLength(0);
  });

  it('skips inset stripes on boxes declared 40px wide or narrower and fires above the gate', async () => {
    const narrow = await ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      '.card { width: 40px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(narrow).toHaveLength(0);

    const wide = await ruleFindings(
      '<div class="card"></div>',
      'side-tab',
      '.card { width: 41px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }',
    );
    expect(wide).toHaveLength(1);
    expect(first(wide)).toMatchObject({
      ruleId: 'side-tab',
      detail: '.card — inset box-shadow 4px stripe (left)',
    });
  });

  it('parses inset-shadow candidates once for many matching elements', async () => {
    document.body.innerHTML = '<div class="card"></div><div class="card"></div><div class="card"></div><div class="card"></div>';
    const sheet = document.createElement('style');
    sheet.textContent = '.card { width: 80px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }';
    document.head.appendChild(sheet);
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll');

    const findings = (await collectFindings(visualDetailsRules, createScanContext(window), new AbortController().signal))
      .filter((finding) => finding.ruleId === 'side-tab');
    expect(findings).toHaveLength(4);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === 'style' || selector === '[style]')).toHaveLength(2);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === 'style')).toHaveLength(1);
    expect(querySelectorAll.mock.calls.filter(([selector]) => selector === '[style]')).toHaveLength(1);
  });

  it('detects an accent top border on a rounded element and rejects 1.5px', async () => {
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
    const positive = (await collectFindings(visualDetailsRules, createScanContext(window), new AbortController().signal))
      .filter((finding) => finding.ruleId === 'border-accent-on-rounded');
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'border-accent-on-rounded',
      detail: 'border-top: 2px + border-radius: 8px',
    });

    const negative = await ruleFindings(
      '<div style="border-top: 1.5px solid rgb(0, 128, 255); border-radius: 8px"></div>',
      'border-accent-on-rounded',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a thin multi-side border with a 16px shadow and rejects 15.9px', async () => {
    const positive = await ruleFindings(
      '<div style="border-top: 1px solid rgba(0, 0, 0, 0.5); border-left: 1px solid rgba(0, 0, 0, 0.5); box-shadow: 0 0 16px rgba(0, 0, 0, 0.2)"></div>',
      'gpt-thin-border-wide-shadow',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'gpt-thin-border-wide-shadow',
      severity: 'advisory',
      detail: '1px border + 16px shadow blur',
    });

    const negative = await ruleFindings(
      '<div style="border-top: 1px solid rgba(0, 0, 0, 0.5); border-left: 1px solid rgba(0, 0, 0, 0.5); box-shadow: 0 0 15.9px rgba(0, 0, 0, 0.2)"></div>',
      'gpt-thin-border-wide-shadow',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects repeating gradient stripes and rejects a non-repeating gradient', async () => {
    const positive = await ruleFindings(
      '<div class="stripe"></div>',
      'repeating-stripes-gradient',
      '.stripe { background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 2px); }',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'repeating-stripes-gradient',
      severity: 'advisory',
      detail: 'repeating-gradient decorative stripes',
    });
    expect(first(positive).el).toBe(document.querySelector('.stripe'));

    const negative = await ruleFindings(
      '<div class="stripe"></div>',
      'repeating-stripes-gradient',
      '.stripe { background-image: linear-gradient(45deg, #fff, transparent); }',
    );
    expect(negative).toHaveLength(0);
  });

  it('groups repeating stripes by background-image value, anchored to the first element with a count', async () => {
    const hits = await ruleFindings(
      '<div id="a1" class="a"></div><div id="b1" class="b"></div><div class="a"></div><div class="a"></div>',
      'repeating-stripes-gradient',
      '.a { background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 2px); } .b { background-image: repeating-linear-gradient(90deg, #000 0 1px, transparent 1px 4px); }',
    );
    expect(hits.map((hit) => hit.detail)).toEqual([
      'repeating-gradient decorative stripes (3 elements)',
      'repeating-gradient decorative stripes',
    ]);
    expect(first(hits).el).toBe(document.querySelector('#a1'));
    expect(hits[1]!.el).toBe(document.querySelector('#b1'));
  });

  it('detects a two-axis hairline grid and rejects a single hairline', async () => {
    const positive = await ruleFindings(
      '<div></div>',
      'codex-grid-background',
      '.grid { background-image: linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px); background-size: 20px 20px; }',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'codex-grid-background',
      severity: 'advisory',
      detail: 'two-axis grid-line gradient background',
    });

    const negative = await ruleFindings(
      '<div></div>',
      'codex-grid-background',
      '.grid { background-image: linear-gradient(to right, #000 1px, transparent 1px); background-size: 20px 20px; }',
    );
    expect(negative).toHaveLength(0);
  });

  it('anchors one repeating-stripes hit to the first element of each distinct stripe value and ignores a stripe rule that matches nothing', async () => {
    const stripe = '.stripe { background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 2px); }';
    const hits = await ruleFindings(
      '<div class="stripe" id="a"></div><div id="plain"></div><div class="stripe" id="b"></div><div id="inline" style="background: repeating-radial-gradient(circle, #000 0 2px, transparent 2px 4px)"></div>',
      'repeating-stripes-gradient',
      stripe,
    );
    expect(hits.map((hit) => hit.el?.id)).toEqual(['a', 'inline']);
    expect(hits[0]!.el).toBe(document.querySelector('#a'));
    expect(hits[1]!.el).toBe(document.querySelector('#inline'));
    expect(hits.map((hit) => hit.detail)).toEqual(['repeating-gradient decorative stripes (2 elements)', 'repeating-gradient decorative stripes']);
    for (const hit of hits) expect(hit).toMatchObject({ severity: 'advisory' });

    expect(await ruleFindings('<div class="other"></div>', 'repeating-stripes-gradient', stripe)).toHaveLength(0);
  });

  it('reports side-tab at advisory severity', async () => {
    const hits = await ruleFindings('<div class="card"></div>', 'side-tab', '.card { width: 200px; box-shadow: inset 4px 0 0 0 rgb(0, 128, 255); }');
    expect(hits).toHaveLength(1);
    expect(first(hits)).toMatchObject({ severity: 'advisory', advisory: true });
    expect(visualDetailsRules.find((rule) => rule.id === 'side-tab')).toMatchObject({ severity: 'advisory' });
  });
});
