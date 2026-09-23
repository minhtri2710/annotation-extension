import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../lint/color';
import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';

const lightTokens = {
  '--annotation-color-surface': '#ffffff',
  '--annotation-color-surface-raised': '#f5f7fa',
  '--annotation-color-text': '#172033',
  '--annotation-color-text-muted': '#5d687a',
  '--annotation-color-border': '#d7dde7',
  '--annotation-color-accent': '#2f6fed',
  '--annotation-color-danger': '#c62828',
  '--annotation-color-warning': '#8a5300',
  '--annotation-space-1': '4px',
  '--annotation-space-2': '8px',
  '--annotation-space-3': '12px',
  '--annotation-space-4': '16px',
  '--annotation-radius-sm': '4px',
  '--annotation-radius-md': '8px',
  '--annotation-radius-lg': '12px',
  '--annotation-font-family': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '--annotation-font-size-caption': '12px',
  '--annotation-font-size-body': '14px',
  '--annotation-font-size-title': '18px',
  '--annotation-font-weight-regular': '400',
  '--annotation-font-weight-medium': '500',
  '--annotation-font-weight-bold': '700',
  '--annotation-line-height': '1.4',
};

const darkTokens = {
  '--annotation-color-surface': '#1b2230',
  '--annotation-color-surface-raised': '#252e3e',
  '--annotation-color-text': '#f1f4f8',
  '--annotation-color-text-muted': '#aab5c5',
  '--annotation-color-border': '#3b475b',
  '--annotation-color-accent': '#80aaff',
  '--annotation-color-danger': '#ff8a80',
  '--annotation-color-warning': '#f5c16c',
};

describe('annotation tokens', () => {
  it('defines the complete light token set', () => {
    for (const [name, value] of Object.entries(lightTokens)) {
      expect(ANNOTATION_TOKENS).toContain(`${name}: ${value};`);
    }
  });

  it('defines dark overrides for every themable token', () => {
    for (const [name, value] of Object.entries(darkTokens)) {
      expect(ANNOTATION_DARK_TOKENS).toContain(`${name}: ${value};`);
    }
    expect(ANNOTATION_DARK_TOKENS).not.toContain('--annotation-space-');
    expect(ANNOTATION_DARK_TOKENS).not.toContain('--annotation-radius-');
    expect(ANNOTATION_DARK_TOKENS).not.toContain('--annotation-font-');
    expect(ANNOTATION_DARK_TOKENS).not.toContain('--annotation-line-height');
  });

  it('replaces the single font-size token with the size scale', () => {
    expect(ANNOTATION_TOKENS).not.toMatch(/--annotation-font-size:/);
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
});

function tokenValue(tokens: string, name: string): string {
  return new RegExp(`${name}: ([^;]+);`).exec(tokens)?.[1] ?? '';
}
