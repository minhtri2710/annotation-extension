import type { Rule } from '../engine';
import { colorRules } from './color';
import { copyRules } from './copy';
import { imageryRules } from './imagery';
import { layoutSpaceRules } from './layout-space';
import { liveStateRules } from './live-state';
import { motionRules } from './motion';
import { typographySizeRules } from './typography-size';
import { typographyStructureRules } from './typography-structure';
import { visualDetailsRules } from './visual-details';

export const ALL_RULES: readonly Rule[] = [
  ...typographySizeRules,
  ...typographyStructureRules,
  ...colorRules,
  ...layoutSpaceRules,
  ...liveStateRules,
  ...motionRules,
  ...visualDetailsRules,
  ...imageryRules,
  ...copyRules,
];
