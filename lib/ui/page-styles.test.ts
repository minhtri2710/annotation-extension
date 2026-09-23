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

  it('uses type tokens instead of font-size and font-weight literals', () => {
    const rules = PAGE_STYLES.replace(ANNOTATION_TOKENS, '');
    const values = [...rules.matchAll(/font-(?:size|weight):\s*([^;]+);/g)].map((match) => match[1]);
    expect(values).toContain('var(--annotation-font-size-body)');
    expect(values).toContain('var(--annotation-font-size-title)');
    for (const value of values) expect(value).toMatch(/^var\(--annotation-font-(?:size|weight)-[a-z]+\)$/);
  });

  it('gives page buttons hover, focus-visible and active states with short transitions', () => {
    expect(PAGE_STYLES).toContain('.annotation-page__card button:hover {\n  border-color: var(--annotation-color-accent);\n  background: var(--annotation-color-surface-raised);');
    expect(PAGE_STYLES).toContain('.annotation-page__card button:focus-visible');
    expect(PAGE_STYLES).toContain('outline: 0.15rem solid var(--annotation-color-accent)');
    expect(PAGE_STYLES).toMatch(/\.annotation-page__card button:active \{\n  transform: /);
    const transitions = [...PAGE_STYLES.matchAll(/transition: ([^;]+);/g)].map((match) => match[1] ?? '');
    expect(transitions.length).toBeGreaterThan(0);
    for (const transition of transitions.filter((value) => value !== 'none')) {
      for (const part of transition.split(',')) {
        const [property, duration] = part.trim().split(/\s+/);
        expect(['color', 'background', 'background-color', 'border-color', 'box-shadow', 'opacity', 'transform']).toContain(property);
        expect(Number.parseInt(duration ?? '', 10)).toBeLessThanOrEqual(150);
      }
    }
    expect(PAGE_STYLES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.annotation-page__card button \{\n    transition: none;/);
  });
});
