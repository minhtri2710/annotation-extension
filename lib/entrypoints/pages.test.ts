// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addAnnotation } from '../annotation-storage';
import { buildInspectExpression } from '../devtools/devtools';
import { readPolicy, SITE_POLICY_STORAGE_KEY, writePolicy } from '../options/storage';

/** Loads an entrypoint's own index.html body (without its module script) into the happy-dom document. */
function loadPage(entry: 'popup' | 'options' | 'devtools-panel') {
  const html = readFileSync(join(import.meta.dirname, '..', '..', 'entrypoints', entry, 'index.html'), 'utf8');
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
  const PAGE = 'https://example.com/page';
  const RELOAD = 'Annotations are not available on this page. If it was open before the extension loaded, reload it.';

  // Stub: the popup reads the active tab and asks it for its capture state through these two tab APIs.
  function stubTab(url: string | undefined, reply: () => Promise<unknown>) {
    const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 11, url }] as never);
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(reply as never);
    return { query, sendMessage };
  }

  const input = (url: string, selector: string) => ({
    note: 'Fix spacing',
    selector,
    elementContext: {
      selector,
      tagName: 'DIV',
      id: '',
      classList: [],
      text: 'Hero',
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      url,
      viewport: { width: 1280, height: 720 },
      sourcePath: null,
    },
  });

  async function openPopup() {
    loadPage('popup');
    await import('../../entrypoints/popup/main');
  }

  it('sends the capture toggle to the active tab and closes the popup', async () => {
    const { query, sendMessage } = stubTab(PAGE, async () => ({ active: false }));
    // Stub: happy-dom's window.close would tear the test window down.
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    await openPopup();
    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));

    byId<HTMLButtonElement>('toggle').click();

    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(sendMessage.mock.calls).toEqual([[11, { type: 'capture.state' }], [11, { type: 'capture.toggle' }]]);
    expect(query.mock.calls).toEqual([[{ active: true, currentWindow: true }], [{ active: true, currentWindow: true }]]);
    expect(byId('status').textContent).toBe('');
  });

  it('names the popup exports and import by format and scope', () => {
    loadPage('popup');
    expect([...document.querySelectorAll('.annotation-page__actions button')].map((button) => button.textContent)).toEqual([
      'Start annotating',
      'Export JSON (all pages)',
      'Export Markdown (all pages)',
      'Import JSON',
    ]);
  });

  it('reports that annotations are unavailable when the tab cannot be reached', async () => {
    let reachable = true;
    stubTab(PAGE, async () => {
      if (reachable) return { active: false };
      throw new Error('Receiving end does not exist.');
    });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    await openPopup();
    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
    reachable = false;

    byId<HTMLButtonElement>('toggle').click();

    await vi.waitFor(() => expect(byId('status').textContent).toBe('Annotations are not available on this page.'));
    expect(close).not.toHaveBeenCalled();
  });

  it('offers Stop annotating when capture is active on the tab', async () => {
    stubTab(PAGE, async () => ({ active: true }));
    await openPopup();

    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
    expect(byId('toggle').textContent).toBe('Stop annotating');
    expect(byId('status').textContent).toBe('');
  });

  it('offers Start annotating when capture is inactive on the tab', async () => {
    stubTab(PAGE, async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
    expect(byId('toggle').textContent).toBe('Start annotating');
  });

  it.each([
    [0, 'No annotations on this page yet.'],
    [1, '1 annotation on this page.'],
    [2, '2 annotations on this page.'],
  ])('counts %i stored annotations on the page', async (count, text) => {
    for (let index = 0; index < count; index += 1) {
      await addAnnotation(PAGE, input(PAGE, `#n${index}`));
    }
    await addAnnotation('https://example.com/other', input('https://example.com/other', '#x'));
    stubTab(PAGE, async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId('page-count').textContent).toBe(text));
  });

  it('disables the toggle on a page the extension cannot run on, without messaging it', async () => {
    const { sendMessage } = stubTab('chrome://extensions/', async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe("Annotations can't run on this page."));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
    expect(byId('page-count').textContent).toBe('');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('disables the toggle when Options turns annotations off for the site, without messaging it', async () => {
    await writePolicy({ enabled: true, allowlist: ['other.example'] });
    const { sendMessage } = stubTab(PAGE, async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe('Annotations are turned off for this site in Options.'));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
    await vi.waitFor(() => expect(byId('page-count').textContent).toBe('No annotations on this page yet.'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a rejected state message', () => Promise.reject(new Error('Receiving end does not exist.'))],
    ['a malformed state reply', () => Promise.resolve({ active: 'yes' })],
  ])('asks for a reload after %s', async (_name, reply) => {
    stubTab(PAGE, reply);
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe(RELOAD));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
  });

  it.each([
    ['no id', { url: PAGE }],
    ['no url', { id: 11 }],
  ])('disables the toggle for an active tab with %s, without messaging it', async (_name, tab) => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([tab] as never);
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue({ active: false } as never);
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe("Annotations can't run on this page."));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('offers Start annotating and the count on a file page', async () => {
    const FILE = 'file:///Users/me/page.html';
    await addAnnotation(FILE, input(FILE, '#n0'));
    stubTab(FILE, async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
    expect(byId('toggle').textContent).toBe('Start annotating');
    await vi.waitFor(() => expect(byId('page-count').textContent).toBe('1 annotation on this page.'));
  });

  it('shows the count on a tab whose state message rejects', async () => {
    await addAnnotation(PAGE, input(PAGE, '#n0'));
    stubTab(PAGE, () => Promise.reject(new Error('Receiving end does not exist.')));
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe(RELOAD));
    await vi.waitFor(() => expect(byId('page-count').textContent).toBe('1 annotation on this page.'));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
  });

  it('leaves the count empty when annotation storage fails and still enables the toggle', async () => {
    const get = browser.storage.local.get.bind(browser.storage.local);
    // Stub: only the annotation read fails; the policy read goes to fakeBrowser storage.
    const storageGet = vi.spyOn(browser.storage.local, 'get').mockImplementation(((keys: string | null) =>
      keys === SITE_POLICY_STORAGE_KEY ? get(keys) : Promise.reject(new Error('Storage failed'))) as never);
    stubTab(PAGE, async () => ({ active: false }));
    await openPopup();

    await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
    await vi.waitFor(() => expect(storageGet.mock.calls.some(([keys]) => keys !== SITE_POLICY_STORAGE_KEY)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(byId('page-count').textContent).toBe('');
    expect(byId('toggle').textContent).toBe('Start annotating');
    expect(byId('status').textContent).toBe('');
  });

  it.each([
    ['tabs.query', () => vi.spyOn(browser.tabs, 'query').mockRejectedValue(new Error('No window'))],
    ['readPolicy', () => {
      stubTab(PAGE, async () => ({ active: false }));
      const get = browser.storage.local.get.bind(browser.storage.local);
      vi.spyOn(browser.storage.local, 'get').mockImplementation(((keys: string | null) =>
        keys === SITE_POLICY_STORAGE_KEY ? Promise.reject(new Error('Storage failed')) : get(keys)) as never);
    }],
  ])('reports the page unavailable when %s rejects', async (_name, stub) => {
    stub();
    await openPopup();

    await vi.waitFor(() => expect(byId('status').textContent).toBe(RELOAD));
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
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
