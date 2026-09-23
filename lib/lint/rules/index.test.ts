import { describe, expect, it } from 'vitest';
import { colorRules } from './color';
import { copyRules } from './copy';
import { imageryRules } from './imagery';
import { hiddenAtRestRules } from './hidden-at-rest';
import { ALL_RULES, DEEP_SCAN_RULES } from './index';
import { layoutSpaceRules } from './layout-space';
import { liveStateRules } from './live-state';
import { motionRules } from './motion';
import { typographySizeRules } from './typography-size';
import { typographyStructureRules } from './typography-structure';
import { visualDetailsRules } from './visual-details';

describe('rule registry', () => {
  it('registers all 55 rules of the nine packs in pack order with unique ids', () => {
    const packs = [
      typographySizeRules,
      typographyStructureRules,
      colorRules,
      layoutSpaceRules,
      liveStateRules,
      motionRules,
      visualDetailsRules,
      imageryRules,
      copyRules,
    ];
    expect(ALL_RULES).toHaveLength(55);
    expect(new Set(ALL_RULES.map((rule) => rule.id)).size).toBe(55);
    expect(ALL_RULES).toEqual(packs.flat());
    for (const pack of packs) for (const rule of pack) expect(ALL_RULES).toContain(rule);
  });

  it('keeps the deep-scan rule out of ALL_RULES and registers it alone in DEEP_SCAN_RULES', () => {
    expect(ALL_RULES).toHaveLength(55);
    expect(ALL_RULES.map((rule) => rule.id)).not.toContain('content-hidden-at-rest');
    expect(DEEP_SCAN_RULES).toHaveLength(1);
    expect(DEEP_SCAN_RULES).toEqual(hiddenAtRestRules);
    expect(DEEP_SCAN_RULES[0]?.id).toBe('content-hidden-at-rest');
    const ids = [...ALL_RULES, ...DEEP_SCAN_RULES].map((rule) => rule.id);
    expect(new Set(ids).size).toBe(56);
  });
});
