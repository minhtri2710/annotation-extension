// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { buildSelector } from './selector';

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
