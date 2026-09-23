import { describe, expect, it } from 'vitest';
import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';

const lightTokens = {
  '--annotation-color-surface': '#ffffff',
  '--annotation-color-surface-raised': '#f5f7fa',
  '--annotation-color-text': '#172033',
  '--annotation-color-text-muted': '#5d687a',
  '--annotation-color-border': '#d7dde7',
  '--annotation-color-accent': '#2f6fed',
  '--annotation-space-1': '0.25rem',
  '--annotation-space-2': '0.5rem',
  '--annotation-space-3': '0.75rem',
  '--annotation-space-4': '1rem',
  '--annotation-radius-sm': '0.25rem',
  '--annotation-radius-md': '0.5rem',
  '--annotation-radius-lg': '0.75rem',
  '--annotation-font-family': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '--annotation-font-size-caption': '0.75rem',
  '--annotation-font-size-body': '0.875rem',
  '--annotation-font-size-title': '1.125rem',
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
});
