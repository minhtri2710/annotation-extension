// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  collectFindings,
  createScanContext,
  type Rule,
} from './engine';

describe('lint engine', () => {
  it('collects element and page hits and enriches them with rule metadata', () => {
    document.body.innerHTML = '<main><button class="target">Save</button></main>';
    const target = document.querySelector('.target')!;
    const ctx = createScanContext(window);
    const rules: Rule[] = [
      {
        id: 'fake-element',
        scope: 'element',
        category: 'quality',
        name: 'Fake element rule',
        description: 'Finds the target element.',
        severity: 'advisory',
        skillSection: 'Testing',
        test: (el) => el.matches('.target') ? [{ detail: 'target hit', ignoreValue: 'target' }] : [],
      },
      {
        id: 'fake-page',
        scope: 'page',
        category: 'slop',
        name: 'Fake page rule',
        description: 'Finds the page.',
        test: () => [{ detail: 'page hit' }],
      },
    ];

    const findings = collectFindings(rules, ctx);

    expect(findings).toEqual([
      {
        ruleId: 'fake-element',
        name: 'Fake element rule',
        description: 'Finds the target element.',
        severity: 'advisory',
        category: 'quality',
        advisory: true,
        skillSection: 'Testing',
        el: target,
        detail: 'target hit',
        ignoreValue: 'target',
      },
      {
        ruleId: 'fake-page',
        name: 'Fake page rule',
        description: 'Finds the page.',
        severity: 'warning',
        category: 'slop',
        advisory: false,
        el: undefined,
        detail: 'page hit',
      },
    ]);
  });

  it('applies disabled rules and disabled values', () => {
    document.body.innerHTML = '<button class="target">Save</button>';
    const target = document.querySelector('.target')!;
    const targetRule: Rule = {
      id: 'fake-target',
      scope: 'element',
      category: 'quality',
      name: 'Target',
      description: 'Target rule.',
      test: (el) => el.matches('.target')
        ? [{ detail: 'keep', ignoreValue: 'keep' }, { detail: 'drop', ignoreValue: 'drop' }]
        : [],
    };
    const disabledRule: Rule = {
      id: 'fake-disabled',
      scope: 'page',
      category: 'quality',
      name: 'Disabled',
      description: 'Disabled rule.',
      test: () => [{ detail: 'disabled' }],
    };

    const findings = collectFindings([targetRule, disabledRule], createScanContext(window, {
      disabledRules: ['fake-disabled'],
      disabledValues: [{ rule: 'fake-target', value: 'drop' }],
    }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'fake-target', detail: 'keep' });
    expect(findings[0].el).toBe(target);
  });

  it('honors skipScan and caches computed styles', () => {
    document.body.innerHTML = '<div id="target">Target</div>';
    const element = document.querySelector('#target')!;
    const ctx = createScanContext(window);

    expect(ctx.config.lineLengthMax).toBe(80);
    expect(ctx.style(element)).toBe(ctx.style(element));
    expect(ctx.style(element, '::before')).toBe(ctx.style(element, '::before'));
    expect(collectFindings([], createScanContext(window, { skipScan: true }))).toEqual([]);
  });
});
