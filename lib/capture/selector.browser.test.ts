import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, isShadowRoot, resolveSelector } from './selector';

const AMBIGUOUS = '<section><div><span>a</span></div></section><div><span>b</span></div>';

function attach(host: Element, html: string): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' });
  root.setHTMLUnsafe(html);
  return root;
}

function shadowHost(tag: string, html: string): ShadowRoot {
  const host = document.createElement(tag);
  document.body.append(host);
  return attach(host, html);
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('shadow selector anchor (real browser)', () => {
  it('anchors an ambiguous top-level shadow segment at the root', () => {
    const root = shadowHost('x-card', AMBIGUOUS);
    const element = root.querySelectorAll('span')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).toBe('x-card >>> div:not(* > div) > span');
    expect(resolveSelector(document, selector)).toBe(element);
    expect(resolveSelector(document, selector)?.textContent).toBe('b');
  });

  it('anchors ambiguous top-level segments in each nested shadow root', () => {
    const outer = shadowHost('x-card', '<section><div><x-chip></x-chip></div></section><div><x-chip></x-chip></div>');
    const [decoyHost, targetHost] = Array.from(outer.querySelectorAll('x-chip'));
    attach(decoyHost as Element, AMBIGUOUS);
    const inner = attach(targetHost as Element, AMBIGUOUS);
    const element = inner.querySelectorAll('span')[1] as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).toBe('x-card >>> div:not(* > div) > x-chip >>> div:not(* > div) > span');
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('keeps the shortest unanchored selector when the shadow path is already unique', () => {
    const root = shadowHost('x-card', '<section><p>a</p></section><div><span>b</span></div>');
    const element = root.querySelector('span') as HTMLElement;

    const selector = buildSelector(element);

    expect(selector).toBe('x-card >>> span');
    expect(resolveSelector(document, selector)).toBe(element);
  });

  it('recognizes a shadow root from another realm (an iframe)', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const host = frameDocument.createElement('x-card');
    frameDocument.body.append(host);
    const root = attach(host, AMBIGUOUS);
    const element = root.querySelectorAll('span')[1] as HTMLElement;

    expect(root instanceof ShadowRoot).toBe(false);
    expect(isShadowRoot(root)).toBe(true);
    const selector = buildSelector(element);
    expect(selector).toBe('x-card >>> div:not(* > div) > span');
    expect(resolveSelector(frameDocument, selector)).toBe(element);
  });
});
