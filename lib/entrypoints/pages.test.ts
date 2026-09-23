// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addAnnotation } from '../annotation-storage';
import { buildInspectExpression } from '../devtools/devtools';
import { readPolicy, writePolicy } from '../options/storage';

/** Loads an entrypoint's own index.html body (without its module script) into the happy-dom document. */
function loadPage(entry: 'popup' | 'options' | 'devtools-panel') {
  const html = readFileSync(join(process.cwd(), 'entrypoints', entry, 'index.html'), 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  page.querySelectorAll('script').forEach((script) => script.remove());
  document.head.replaceChildren();
  document.body.className = page.body.className;
  document.body.replaceChildren(...page.body.childNodes);
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('popup page', () => {
  it('sends the capture toggle to the active tab and closes the popup', async () => {
    loadPage('popup');
    const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 11 }] as never);
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);
    // Stub: happy-dom's window.close would tear the test window down.
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    await import('../../entrypoints/popup/main');

    byId<HTMLButtonElement>('toggle').click();

    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(sendMessage.mock.calls).toEqual([[11, { type: 'capture.toggle' }]]);
    expect(query.mock.calls).toEqual([[{ active: true, currentWindow: true }]]);
    expect(byId('status').textContent).toBe('');
  });

  it('reports that annotations are unavailable when the tab cannot be reached', async () => {
    loadPage('popup');
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 11 }] as never);
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('Receiving end does not exist.'));
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    await import('../../entrypoints/popup/main');

    byId<HTMLButtonElement>('toggle').click();

    await vi.waitFor(() => expect(byId('status').textContent).toBe('Annotations are not available on this page.'));
    expect(close).not.toHaveBeenCalled();
  });
});

describe('options page', () => {
  it('shows the stored policy and saves an added site', async () => {
    await writePolicy({ enabled: false, allowlist: ['a.example'] });
    loadPage('options');
    await import('../../entrypoints/options/main');
    const enabled = byId<HTMLInputElement>('enabled');
    await vi.waitFor(() => expect(byId('allowlist').querySelector('li')?.firstChild?.textContent).toBe('a.example'));
    expect(enabled.checked).toBe(false);

    byId<HTMLInputElement>('allowlist-entry').value = 'docs.example.com';
    byId<HTMLFormElement>('allowlist-form').dispatchEvent(new Event('submit', { cancelable: true }));
    byId<HTMLButtonElement>('save').click();

    await vi.waitFor(() => expect(byId('status').textContent).toBe('Settings saved.'));
    expect(await readPolicy()).toEqual({ enabled: false, allowlist: ['a.example', 'docs.example.com'] });
  });
});

describe('devtools panel', () => {
  const pageUrl = 'https://example.com/inspected';

  it('lists the inspected page annotations and inspects the chosen element', async () => {
    await addAnnotation(pageUrl, {
      note: 'Fix spacing',
      selector: '#hero',
      elementContext: {
        selector: '#hero',
        tagName: 'DIV',
        id: 'hero',
        classList: [],
        text: 'Hero',
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        url: pageUrl,
        viewport: { width: 1280, height: 720 },
        sourcePath: null,
      },
    });
    loadPage('devtools-panel');
    // Stub: fakeBrowser does not implement devtools.inspectedWindow.eval.
    const evaluate = vi.spyOn(browser.devtools.inspectedWindow, 'eval')
      .mockImplementation(async (expression: string) => (expression === 'location.href' ? pageUrl : undefined) as never);
    await import('../../entrypoints/devtools-panel/main');

    await vi.waitFor(() => expect(byId('status').textContent).toBe(''));
    const [row] = byId('annotations').querySelectorAll('li');
    expect(row?.querySelector('strong')?.textContent).toBe('Fix spacing');
    expect(row?.querySelector('code')?.textContent).toBe('#hero');

    row!.querySelector('button')!.click();

    expect(evaluate.mock.calls.map(([expression]) => expression)).toEqual(['location.href', buildInspectExpression('#hero')]);
  });
});
