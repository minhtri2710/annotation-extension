// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { buildSelector, resolveSelector, SHADOW_SELECTOR_DELIMITER } from './selector';

describe('buildSelector', () => {
  it('uses a unique id as the selector', () => {
    document.body.innerHTML = '<main><button id="save">Save</button></main>';
    const element = document.querySelector('#save') as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).toBe('#save');
    expect(document.querySelector(selector)).toBe(element);
  });

  it('builds a round-trippable path for same-tag siblings', () => {
    document.body.innerHTML = `
      <main>
        <section><button>First</button></section>
        <section><button>Second</button></section>
      </main>
    `;
    const element = document.querySelectorAll('button')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).not.toBe('button');
    expect(document.querySelector(selector)).toBe(element);
    expect(document.querySelector(selector)).not.toBe(document.querySelector('button'));
  });

  it('resolves nested elements through their ancestor path', () => {
    document.body.innerHTML = `
      <div class="layout">
        <article><p>First</p></article>
        <article><p>Second</p></article>
      </div>
    `;
    const element = document.querySelectorAll('p')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(document.querySelector(selector)).toBe(element);
  });
});

function shadowHost(tag: string, html: string, parent: ParentNode = document.body): ShadowRoot {
  const host = document.createElement(tag);
  parent.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

describe('shadow selectors', () => {
  it('keeps the light-DOM path for the same ambiguity unanchored', () => {
    document.body.innerHTML = '<section><div><span>a</span></div></section><div><span>b</span></div>';
    const element = document.querySelectorAll('span')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).toBe('body > div > span');
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('keeps a light-DOM selector free of the delimiter and round-trips it', () => {
    document.body.innerHTML = '<main><p>One</p><p>Two</p></main>';
    const element = document.querySelectorAll('p')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).not.toContain(SHADOW_SELECTOR_DELIMITER);
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('round-trips an element one shadow level deep', () => {
    document.body.innerHTML = '';
    const root = shadowHost('x-card', '<div><span>a</span><span>b</span></div>');
    const element = root.querySelectorAll('span')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(SHADOW_SELECTOR_DELIMITER).toBe(' >>> ');
    expect(selector.split(SHADOW_SELECTOR_DELIMITER)).toHaveLength(2);
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('round-trips an element inside nested open shadow roots', () => {
    document.body.innerHTML = '';
    const outer = shadowHost('x-card', '<section></section>');
    const inner = shadowHost('x-chip', '<b>x</b><b>y</b>', outer.querySelector('section')!);
    const element = inner.querySelectorAll('b')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector.split(SHADOW_SELECTOR_DELIMITER)).toHaveLength(3);
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('scopes id uniqueness to the shadow root', () => {
    document.body.innerHTML = '<button id="dup">light</button>';
    const root = shadowHost('x-card', '<button id="dup">shadow</button>');
    const element = root.querySelector('#dup') as HTMLElement;

    const selector = buildSelector(element);

    expect(selector.endsWith(`${SHADOW_SELECTOR_DELIMITER}#dup`)).toBe(true);
    expect(resolveSelector(document, selector)).toBe(element);
  });
});

describe('resolveSelector', () => {
  function setup() {
    document.body.innerHTML = '<button id="target">Target</button><div id="closed"></div>';
    document.querySelector('#closed')!.attachShadow({ mode: 'closed' }).innerHTML = '<i>hidden</i>';
  }

  it('resolves a valid selector', () => {
    setup();

    expect(resolveSelector(document, '#target')).toBe(document.querySelector('#target'));
  });

  it('returns null for a missing element', () => {
    setup();

    expect(resolveSelector(document, '#missing')).toBeNull();
  });

  it('returns null for an invalid selector without throwing', () => {
    setup();

    expect(() => resolveSelector(document, '[')).not.toThrow();
    expect(resolveSelector(document, '[')).toBeNull();
  });

  it('returns null for a missing element mid-path', () => {
    setup();

    expect(resolveSelector(document, `#missing${SHADOW_SELECTOR_DELIMITER}i`)).toBeNull();
  });

  it('returns null when a mid-path element has no shadow root', () => {
    setup();

    expect(resolveSelector(document, `#target${SHADOW_SELECTOR_DELIMITER}i`)).toBeNull();
  });

  it('returns null when a mid-path shadow root is closed', () => {
    setup();

    expect(resolveSelector(document, `#closed${SHADOW_SELECTOR_DELIMITER}i`)).toBeNull();
  });

  it('returns null for an invalid later part without throwing', () => {
    setup();
    shadowHost('x-card', '<i>open</i>');

    expect(() => resolveSelector(document, `x-card${SHADOW_SELECTOR_DELIMITER}[`)).not.toThrow();
    expect(resolveSelector(document, `x-card${SHADOW_SELECTOR_DELIMITER}[`)).toBeNull();
  });

  it('returns null for an empty part', () => {
    setup();
    shadowHost('x-card', '<i>open</i>');

    expect(resolveSelector(document, '')).toBeNull();
    expect(resolveSelector(document, `x-card${SHADOW_SELECTOR_DELIMITER}`)).toBeNull();
    expect(resolveSelector(document, `${SHADOW_SELECTOR_DELIMITER}i`)).toBeNull();
  });
});
