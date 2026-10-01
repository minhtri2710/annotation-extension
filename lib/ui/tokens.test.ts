import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../lint/color';
import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';
import { PAGE_STYLES } from './page-styles';
import { OVERLAY_STYLES } from './styles';

describe('annotation tokens', () => {
  it('keeps style references declared and dark overrides limited to declared colour tokens', () => {
    const declared = new Set([...ANNOTATION_TOKENS.matchAll(/(--annotation-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    const styles = `${ANNOTATION_TOKENS}\n${ANNOTATION_DARK_TOKENS}\n${OVERLAY_STYLES}\n${PAGE_STYLES}`;
    const references = [...styles.matchAll(/var\((--annotation-[a-z0-9-]+)\)/g)].map((match) => match[1]!);
    const darkOverrides = [...ANNOTATION_DARK_TOKENS.matchAll(/(--annotation-[a-z0-9-]+)\s*:/g)].map((match) => match[1]!);
    expect(references.every((name) => declared.has(name))).toBe(true);
    expect(darkOverrides.every((name) => declared.has(name) && name.startsWith('--annotation-color-'))).toBe(true);
  });

  it('defines danger and warning colours readable on the surface in both themes', () => {
    for (const tokens of [ANNOTATION_TOKENS, ANNOTATION_DARK_TOKENS]) {
      const surface = parseColor(tokenValue(tokens, '--annotation-color-surface'));
      expect(surface).toBeDefined();
      for (const name of ['--annotation-color-danger', '--annotation-color-warning']) {
        const color = parseColor(tokenValue(tokens, name));
        expect(color, name).toBeDefined();
        if (color && surface) expect(contrastRatio(color, surface), name).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps every tier text pair at 4.5:1 and the control border at 3:1 in both themes', () => {
    const pairs = [
      ['--annotation-color-on-accent', '--annotation-color-accent'],
      ['--annotation-color-on-accent', '--annotation-color-danger'],
      ['--annotation-color-text', '--annotation-color-surface-raised'],
      ['--annotation-color-text', '--annotation-color-hover'],
      ['--annotation-color-text-muted', '--annotation-color-surface'],
      ['--annotation-color-text-muted', '--annotation-color-surface-raised'],
      ['--annotation-color-danger', '--annotation-color-surface'],
      ['--annotation-color-danger', '--annotation-color-hover'],
      ['--annotation-color-accent', '--annotation-color-surface-raised'],
      ['--annotation-color-accent', '--annotation-color-surface'],
    ] as const;
    for (const tokens of [ANNOTATION_TOKENS, `${ANNOTATION_TOKENS}\n${ANNOTATION_DARK_TOKENS}`]) {
      const value = (name: string) => {
        const all = [...tokens.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))];
        return parseColor(all[all.length - 1]?.[1] ?? '')!;
      };
      for (const [foreground, background] of pairs) {
        expect(contrastRatio(value(foreground), value(background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(value('--annotation-color-border'), value('--annotation-color-surface'))).toBeGreaterThanOrEqual(3);
    }
  });
});

function tokenValue(tokens: string, name: string): string {
  return new RegExp(`${name}: ([^;]+);`).exec(tokens)?.[1] ?? '';
}
