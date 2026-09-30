import { beforeEach, describe, expect, it } from 'vitest';
import { extractElementContext } from './context';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('extractElementContext text (real browser)', () => {
  it('records only the visible text of an element built in the page', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<p>Hello <b>world</b></p><style>.a{color:red}</style><script>var s = 1;</script>' +
      '<noscript>enable js</noscript><template><i>tpl</i></template>\n  <span>again</span>';
    const scripted = document.createElement('template');
    scripted.append('appended tpl');
    host.append(scripted, ' end');
    document.body.append(host);

    const context = extractElementContext(host);

    expect(context.text).toBe('Hello world again end');
  });
});
