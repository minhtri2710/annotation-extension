import { describe, expect, it } from 'vitest';
import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';
import { PAGE_STYLES } from './page-styles';

describe('page styles', () => {
  it('puts the shared tokens at the page root with dark handling', () => {
    expect(PAGE_STYLES).toContain(`:root {\n${ANNOTATION_TOKENS}\n}`);
    expect(PAGE_STYLES).toContain('@media (prefers-color-scheme: dark)');
    expect(PAGE_STYLES).toContain(`  :root {\n${ANNOTATION_DARK_TOKENS}\n  }`);
  });

  it('styles the popup and options hooks with shared token references', () => {
    for (const selector of [
      'body.annotation-page--popup',
      'body.annotation-page--options',
      '.annotation-page__card',
      '.annotation-page__actions',
      '.annotation-page__toggle',
      '.annotation-page__form',
      '.annotation-page__list',
      '.annotation-page__status',
    ]) {
      expect(PAGE_STYLES).toContain(selector);
    }

    expect(PAGE_STYLES).toContain('background: var(--annotation-color-surface)');
    expect(PAGE_STYLES).toContain('color: var(--annotation-color-text)');
    expect(PAGE_STYLES).toContain('border: 1px solid var(--annotation-color-border)');
    expect(PAGE_STYLES).toContain('border-radius: var(--annotation-radius-lg)');
    expect(PAGE_STYLES).toContain('padding: var(--annotation-space-4)');
    expect(PAGE_STYLES).toContain('font-family: var(--annotation-font-family)');

    const pageRules = PAGE_STYLES
      .replace(ANNOTATION_TOKENS, '')
      .replace(ANNOTATION_DARK_TOKENS, '');
    expect(pageRules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
