import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { buildAnnotationRows, buildInspectExpression } from './devtools';

const annotation = (note: string, selector: string): Annotation => ({
  id: `${note}-id`,
  pageUrl: 'https://example.com/page',
  note,
  selector,
  elementContext: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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

  it('maps annotations to note and selector rows', () => {
    expect(buildAnnotationRows([annotation('First note', '#first'), annotation('Second', '.second')])).toEqual([
      { note: 'First note', selector: '#first' },
      { note: 'Second', selector: '.second' },
    ]);
    expect(buildAnnotationRows([])).toEqual([]);
  });
});
