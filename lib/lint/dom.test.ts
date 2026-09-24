// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { classSelector, collapseWhitespace, hasDirectTextLongerThan, styleValue, tagName } from './dom';
import type { ScanContext } from './engine';

function element(tag: string, className = ''): Element {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

describe('lint dom helpers', () => {
  it('reads a trimmed style value for the requested pseudo element', () => {
    const el = document.createElement('p');
    const calls: Array<string | undefined> = [];
    const ctx = {
      style: (_el: Element, pseudo?: string) => {
        calls.push(pseudo);
        return { getPropertyValue: (property: string) => (property === 'color' ? '  red  ' : '') } as CSSStyleDeclaration;
      },
    } as ScanContext;
    expect(styleValue(ctx, el, 'color', '::before')).toBe('red');
    expect(calls).toEqual(['::before']);
  });

  it('builds a tag.class selector, or the bare tag without classes', () => {
    expect(classSelector(element('span', 'a  b'))).toBe('span.a.b');
    expect(classSelector(element('em'))).toBe('em');
  });

  it('collapses inner whitespace runs and trims the ends', () => {
    expect(collapseWhitespace('  a \n\t b  ')).toBe('a b');
  });

  it('returns the lowercase tag name', () => {
    expect(tagName(document.createElementNS('http://www.w3.org/1999/xhtml', 'SECTION'))).toBe('section');
  });

  it('counts only trimmed direct text nodes, strictly longer than the minimum', () => {
    const el = element('div');
    el.append('  abc  ', element('b'));
    el.lastElementChild!.append('longer child text');
    expect(hasDirectTextLongerThan(el, 2)).toBe(true);
    expect(hasDirectTextLongerThan(el, 3)).toBe(false);
  });
});
