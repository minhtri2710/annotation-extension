import { afterEach, describe, expect, it } from 'vitest';
import type { Annotation, CssDeclaration } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createNotePanelPersistence } from './persistence';

const pageUrl = 'https://example.com/article';
const elementContext: ElementContext = {
  selector: '#target',
  tagName: 'DIV',
  id: 'target',
  classList: [],
  text: '',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

function annotation(): Annotation {
  return {
    id: 'annotation-1',
    pageUrl,
    note: 'Probe',
    selector: '#target',
    elementContext,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('note panel persistence CSS edits', () => {
  it('skips CSS declarations whose value would fetch a resource and keeps the rest', () => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.append(target);
    const declarations: CssDeclaration[] = [
      { property: 'color', value: 'rgb(255, 0, 0)' },
      { property: 'background-image', value: 'u\\72l(https://example.invalid/a.png)' },
      { property: '--annotation-probe-case', value: 'URL(https://example.invalid/b.png)' },
      { property: '--annotation-probe-escape', value: 'u\\72l(https://example.invalid/c.png)' },
      { property: '--annotation-probe-set', value: 'image-set("https://example.invalid/d.png" 1x)' },
      { property: '--annotation-probe-string', value: '"https://example.invalid/e.png"' },
      { property: '--annotation-probe-single', value: "'https://example.invalid/f.png'" },
      { property: '--annotation-probe-token', value: 'rgb(0, 128, 0)' },
    ];

    const result = createNotePanelPersistence().applyCssEdits(annotation(), declarations);

    expect(result?.edits.map(({ property, value }) => ({ property, value }))).toEqual([
      { property: 'color', value: 'rgb(255, 0, 0)' },
      { property: '--annotation-probe-token', value: 'rgb(0, 128, 0)' },
    ]);
    expect(result?.refused).toEqual([
      { property: 'background-image', value: 'u\\72l(https://example.invalid/a.png)' },
      { property: '--annotation-probe-case', value: 'URL(https://example.invalid/b.png)' },
      { property: '--annotation-probe-escape', value: 'u\\72l(https://example.invalid/c.png)' },
      { property: '--annotation-probe-set', value: 'image-set("https://example.invalid/d.png" 1x)' },
      { property: '--annotation-probe-string', value: '"https://example.invalid/e.png"' },
      { property: '--annotation-probe-single', value: "'https://example.invalid/f.png'" },
    ]);
    expect(target.style.getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(target.style.getPropertyValue('--annotation-probe-token')).toBe('rgb(0, 128, 0)');
    for (const { property } of declarations.slice(1, 7)) {
      expect(target.style.getPropertyValue(property)).toBe('');
    }
  });
});
