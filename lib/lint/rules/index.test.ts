import { describe, expect, it } from 'vitest';
import { colorRules } from './color';
import { copyRules } from './copy';
import { imageryRules } from './imagery';
import { ALL_RULES } from './index';
import { layoutSpaceRules } from './layout-space';
import { liveStateRules } from './live-state';
import { motionRules } from './motion';
import { typographySizeRules } from './typography-size';
import { typographyStructureRules } from './typography-structure';
import { visualDetailsRules } from './visual-details';

describe('rule registry', () => {
  it('registers all 59 rules of the nine packs in pack order with unique ids', () => {
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
    expect(ALL_RULES).toHaveLength(59);
    expect(new Set(ALL_RULES.map((rule) => rule.id)).size).toBe(59);
    expect(ALL_RULES).toEqual(packs.flat());
    for (const pack of packs) for (const rule of pack) expect(ALL_RULES).toContain(rule);
  });
});
