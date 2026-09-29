import { describe, expect, it } from 'vitest';
import { buildInspectExpression } from './devtools';

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

});
