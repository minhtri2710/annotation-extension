import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { buildAnnotationRows, buildInspectExpression } from './devtools';
import type { ElementContext } from '../capture/context';

const elementContext: ElementContext = {
  selector: '#target',
  tagName: 'BUTTON',
  id: 'target',
  classList: [],
  text: 'Target',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  url: 'https://example.com/page',
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

const annotation = (note: string, selector: string): Annotation => ({
  id: `${note}-id`,
  pageUrl: 'https://example.com/page',
  note,
  selector,
  elementContext,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'open',
});

describe('devtools helpers', () => {
  it('builds an inspect expression with a safely embedded selector', () => {
    expect(buildInspectExpression('#a .b')).toBe(
      'inspect(document.querySelector("#a .b"))',
    );
    expect(buildInspectExpression('a"];evil()//\\')).toBe(
      'inspect(document.querySelector("a\\"];evil()//\\\\"))',
    );
  });

  it('builds an inspect expression that walks open shadow roots', () => {
    expect(buildInspectExpression('x-card >>> div > "b"')).toBe(
      'inspect(document.querySelector("x-card")?.shadowRoot?.querySelector("div > \\"b\\""))',
    );
    expect(buildInspectExpression('a >>> b >>> #c')).toBe(
      'inspect(document.querySelector("a")?.shadowRoot?.querySelector("b")?.shadowRoot?.querySelector("#c"))',
    );
  });

  it('maps annotations to note and selector rows', () => {
    expect(buildAnnotationRows([annotation('First note', '#first'), annotation('Second', '.second')])).toEqual([
      { note: 'First note', selector: '#first' },
      { note: 'Second', selector: '.second' },
    ]);
    expect(buildAnnotationRows([])).toEqual([]);
  });
});
