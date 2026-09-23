// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { hiddenAtRestRules } from './hidden-at-rest';

function text(length: number): string {
  return 'x'.repeat(length);
}

function load(html: string): void {
  const base = document.createElement('style');
  base.textContent = 'body, body * { opacity: 1; }';
  document.head.replaceChildren(base);
  document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
}

async function detailsFor(): Promise<string[]> {
  return (await collectFindings(hiddenAtRestRules, createScanContext(window), new AbortController().signal)).map((finding) => finding.detail);
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('content-hidden-at-rest', () => {
  it('registers one error-severity page rule with impeccable metadata', () => {
    expect(hiddenAtRestRules).toHaveLength(1);
    const [rule] = hiddenAtRestRules;
    expect(rule).toMatchObject({
      id: 'content-hidden-at-rest',
      category: 'quality',
      severity: 'error',
      scope: 'page',
      name: 'Content invisible at rest',
    });
    expect(rule?.description).toBe(
      'A large share of the page text sits at opacity 0 even after every reveal handler had a chance to run. This is the failed-reveal signature: the content shipped but never becomes visible. Make content visible by default and let JavaScript enhance its entrance instead of gating its existence.',
    );
  });

  it('fires once with the share, counts, and first hidden sample', async () => {
    load(`<p>${text(100)}</p><section style="opacity: 0"><p>Hidden hero copy ${text(150)}</p></section>`);
    const details = await detailsFor();
    expect(details).toHaveLength(1);
    expect(details[0]).toBe(
      `63% of page text (167 of 267 chars) stays at opacity 0 after reveal handlers ran (e.g. "Hidden hero copy ${text(23)}")`,
    );
  });

  it('does not fire when total text is 199 chars', async () => {
    load(`<p>${text(49)}</p><p style="opacity: 0">${text(150)}</p>`);
    expect(await detailsFor()).toEqual([]);
  });

  it('does not fire when hidden text is 149 chars', async () => {
    load(`<p>${text(51)}</p><p style="opacity: 0">${text(149)}</p>`);
    expect(await detailsFor()).toEqual([]);
  });

  it('does not fire when the hidden share is exactly 0.3', async () => {
    load(`<p>${text(350)}</p><p style="opacity: 0">${text(150)}</p>`);
    expect(await detailsFor()).toEqual([]);
  });

  it('fires just above the 0.3 share', async () => {
    load(`<p>${text(349)}</p><p style="opacity: 0">${text(150)}</p>`);
    expect(await detailsFor()).toHaveLength(1);
    expect(await detailsFor()).toEqual([
      `30% of page text (150 of 499 chars) stays at opacity 0 after reveal handlers ran (e.g. "${text(40)}")`,
    ]);
  });

  it('counts opacity at or below 0.02 as hidden and above it as visible', async () => {
    load(`<p>${text(50)}</p><p style="opacity: 0.02">${text(150)}</p>`);
    expect(await detailsFor()).toHaveLength(1);
    expect(await detailsFor()).toEqual([
      `75% of page text (150 of 200 chars) stays at opacity 0 after reveal handlers ran (e.g. "${text(40)}")`,
    ]);
    load(`<p>${text(50)}</p><p style="opacity: 0.03">${text(150)}</p>`);
    expect(await detailsFor()).toEqual([]);
  });

  it('excludes visibility hidden and collapse from both counts', async () => {
    load(`<p>${text(50)}</p><p style="visibility: hidden">${text(150)}</p>`);
    expect(await detailsFor()).toEqual([]);
    load(`<p>${text(50)}</p><p style="opacity: 0">${text(150)}</p><div style="visibility: hidden"><p style="opacity: 0">${text(500)}</p></div>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
    load(`<p>${text(50)}</p><p style="opacity: 0">${text(150)}</p><p style="visibility: collapse">${text(500)}</p>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });

  it('counts a visibility visible child of a visibility hidden parent', async () => {
    load(`<p style="opacity: 0">${text(150)}</p><div style="visibility: hidden">${text(500)}<p style="visibility: visible">${text(50)}</p></div>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });

  it('inherits invisibility from an invisible ancestor', async () => {
    load(`<p>${text(50)}</p><div style="opacity: 0"><p><span>${text(150)}</span></p></div>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });

  it.each([
    ['display none', `<div style="display: none">`],
    ['the hidden attribute', `<div hidden style="display: block">`],
    ['aria-hidden true', `<div aria-hidden="true">`],
    ['content-visibility hidden', `<div style="content-visibility: hidden">`],
  ])('excludes text under %s from both counts', async (_label, open) => {
    load(`<p>${text(50)}</p><p style="opacity: 0">${text(150)}</p>${open}<p style="opacity: 0">${text(500)}</p></div>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });

  it.each(['script', 'style', 'noscript', 'template', 'select', 'datalist', 'dialog'])(
    'excludes text inside <%s>',
    async (tag) => {
      load(`<p>${text(50)}</p><p style="opacity: 0">${text(150)}</p><${tag} style="opacity: 0">${text(500)}</${tag}>`);
      expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
    },
  );

  it('counts collapsed, trimmed direct text only', async () => {
    load(`<p>  ${text(25)}   \n  ${text(24)}  </p><p style="opacity: 0">${text(150)}</p>`);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });

  it('does not count text inside shadow roots', async () => {
    load(`<p>${text(50)}</p><p style="opacity: 0">${text(150)}</p><div id="host"></div>`);
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    const inner = document.createElement('p');
    inner.textContent = text(5000);
    shadow.append(inner);
    expect((await detailsFor())[0]).toContain('(150 of 200 chars)');
  });
});
