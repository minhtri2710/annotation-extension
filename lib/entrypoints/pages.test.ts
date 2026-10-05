// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, type Browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addAnnotation, listAnnotations } from '../annotation-storage';
import type { Annotation } from '../annotation';
import { IMPORT_CHUNK_LENGTH, IMPORT_PORT_NAME } from '../json-io';
import background from '../../entrypoints/background';
import { registerBackgroundMessageHandlers } from '../wiring/background-messages';
import { buildInspectExpression } from '../devtools/devtools';
import { readPolicy, SITE_POLICY_STORAGE_KEY, writePolicy } from '../options/storage';

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

  function dispatchImportFileChange(text: string): void {
    const fileInput = byId<HTMLInputElement>('import-file');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File([text], 'annotations.json', { type: 'application/json' })] });
    fileInput.dispatchEvent(new Event('change'));
  }

  function importedAnnotation(id: string): Annotation {
    return {
      id,
      pageUrl: PAGE,
      note: 'Imported note',
      selector: '#target',
      elementContext: input(PAGE, '#target').elementContext,
      createdAt: '2024-02-01T10:00:00.000Z',
      updatedAt: '2024-02-01T10:00:00.000Z',
      status: 'open',
    };
  }

  beforeEach(() => {
    vi.spyOn(browser.commands, 'getAll').mockResolvedValue([{ name: 'capture.toggle', shortcut: 'Alt+Shift+Y' }] as never);
  });

  it('sends the capture toggle to the active tab and closes the popup', async () => {
    const { query, sendMessage } = stubTab(PAGE, async () => ({ active: false }));
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
    const card = document.querySelector('.annotation-page__card')!;
    expect([...card.children].map((child) => child.tagName)).toEqual(['HEADER', 'BUTTON', 'P', 'BUTTON', 'SECTION', 'INPUT', 'P']);
    const [, toggle, hint, , allPages] = [...card.children];
    expect(toggle?.id).toBe('toggle');
    expect(byId('toggle').dataset.variant).toBe('primary');
    expect(hint?.id).toBe('shortcut-hint');
    expect(allPages?.querySelector('h2')?.textContent).toBe('All pages');
    expect(allPages?.querySelector('.annotation-page__group-head')?.nextElementSibling?.className).toBe('annotation-page__actions');
    expect([...document.querySelectorAll('.annotation-page__actions button')].map((button) => button.getAttribute('aria-label'))).toEqual([
      'Export JSON',
      'Export Markdown',
    ]);
  });

  it('shows the export and import buttons as JSON, Markdown and Import with their full accessible names', () => {
    loadPage('popup');
    const names = ['export', 'export-markdown', 'import'].map((id) => [byId(id).textContent, byId(id).getAttribute('aria-label')]);
    expect(names).toEqual([
      ['JSON', 'Export JSON'],
      ['Markdown', 'Export Markdown'],
      ['Import', 'Import JSON'],
    ]);
  });

  it('sends import text in ordered bounded chunks, displays the reply, writes nothing locally, and disconnects', async () => {
    const json = 'x'.repeat(IMPORT_CHUNK_LENGTH * 2 + 17);
    const received: { type: string; text?: string }[] = [];
    let receivedPort: Browser.runtime.Port | undefined;
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== IMPORT_PORT_NAME) return;
      receivedPort = port;
      port.onMessage.addListener((message: unknown) => {
        received.push(message as { type: string; text?: string });
        if ((message as { type?: string }).type === 'end') port.postMessage({ status: 'receiver status' });
      });
    });
    const set = vi.spyOn(browser.storage.local, 'set');
    const disconnected = vi.fn();
    await openPopup();
    browser.runtime.onConnect.addListener((port) => {
      if (port.name === IMPORT_PORT_NAME) port.onDisconnect.addListener(disconnected);
    });

    dispatchImportFileChange(json);

    await vi.waitFor(() => expect(byId('status').textContent).toBe('receiver status'));
    expect(received.map((message) => message.type)).toEqual(['chunk', 'chunk', 'chunk', 'end']);
    const chunks = received.filter((message) => message.type === 'chunk').map((message) => message.text ?? '');
    expect(chunks.map((chunk) => chunk.length)).toEqual([IMPORT_CHUNK_LENGTH, IMPORT_CHUNK_LENGTH, 17]);
    expect(chunks.join('')).toBe(json);
    expect(set).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    expect(receivedPort?.name).toBe(IMPORT_PORT_NAME);

    received.length = 0;
    dispatchImportFileChange('');
    await vi.waitFor(() => expect(received).toEqual([{ type: 'end' }]));
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledTimes(2));
    expect(byId('status').textContent).toBe('receiver status');
  });

  it('imports through the real background receiver into its storage owner', async () => {
    const source = importedAnnotation('popup-import-live');
    const set = vi.spyOn(browser.storage.local, 'set');
    registerBackgroundMessageHandlers();
    await openPopup();

    dispatchImportFileChange(JSON.stringify([source]));

    await vi.waitFor(() => expect(byId('status').textContent).toBe('Imported 1 annotation, skipped 0 already present.'));
    await expect(listAnnotations(PAGE)).resolves.toEqual([source]);
    expect(set).toHaveBeenCalled();
  });

  it('shows the partial-import warning when the receiver disconnects before replying', async () => {
    browser.runtime.onConnect.addListener((port) => {
      if (port.name === IMPORT_PORT_NAME) port.disconnect();
    });
    await openPopup();

    dispatchImportFileChange(JSON.stringify([importedAnnotation('popup-import-disconnect')]));

    await vi.waitFor(() => expect(byId('status').textContent).toBe(
      'Import did not finish. Some annotations may have been imported; open View all on a page to check.',
    ));
    await expect(listAnnotations(PAGE)).resolves.toEqual([]);
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

  describe('toolbar visibility', () => {
    const TOOLBAR_SAVE_ERROR = 'The toolbar setting could not be saved.';
    const toolbarToggle = () => byId<HTMLButtonElement>('toolbar-toggle');

    const TAB_KEY = 'ui:toolbar-tab:11';
    const startBackground = () => background.main();

    it.each<[string, Record<string, boolean>, string]>([
      ['off', { 'ui:toolbar-tab:12': true }, 'false'],
      ['on', { [TAB_KEY]: true }, 'true'],
    ])('marks the button for the active tab whose toolbar is %s', async (_name, session, checked) => {
      startBackground();
      await fakeBrowser.storage.session.set(session);
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));
      expect(toolbarToggle().getAttribute('aria-checked')).toBe(checked);
      expect(toolbarToggle().hasAttribute('data-variant')).toBe(false);
      expect(toolbarToggle().parentElement).toBe(byId('toggle').parentElement);
    });

    it.each<[string, Record<string, boolean>, string]>([
      ['off', { 'ui:toolbar-tab:12': true }, 'false'],
      ['on', { [TAB_KEY]: true }, 'true'],
    ])('is a switch with a fixed label whose aria-checked follows the active tab whose toolbar is %s', async (_name, session, checked) => {
      startBackground();
      await fakeBrowser.storage.session.set(session);
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));
      expect(toolbarToggle().getAttribute('role')).toBe('switch');
      expect(toolbarToggle().getAttribute('aria-checked')).toBe(checked);
      expect(toolbarToggle().textContent).toBe('Show toolbar on this tab');
    });

    it('reads aria-checked false while the state is unread and after a failed set', async () => {
      startBackground();
      stubTab(PAGE, async () => ({ active: false }));
      vi.spyOn(window, 'close').mockImplementation(() => {});
      await openPopup();
      expect(toolbarToggle().getAttribute('aria-checked')).toBe('false');
      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));
      vi.spyOn(browser.storage.session, 'set').mockRejectedValue(new Error('Storage failed'));
      toolbarToggle().click();
      await vi.waitFor(() => expect(byId('status').textContent).toBe(TOOLBAR_SAVE_ERROR));
      expect(toolbarToggle().getAttribute('aria-checked')).toBe('false');
    });

    it.each([
      ['a rejected read', () => Promise.reject(new Error('Storage failed'))],
      ['a malformed answer', () => Promise.resolve({ on: 'yes' })],
    ])('reads the state as off after %s: the switch is off and enabled', async (_name, answer) => {
      const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((() => answer()) as never);
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));
      expect(send.mock.calls).toEqual([[{ type: 'toolbar.get', tabId: 11 }]]);
      expect(toolbarToggle().getAttribute('aria-checked')).toBe('false');
    });

    it.each([
      ['off', undefined, { [TAB_KEY]: true }],
      ['on', { [TAB_KEY]: true }, {}],
    ])('sets the active tab when its toolbar is %s to the other state, then closes the popup', async (_name, session, saved) => {
      startBackground();
      if (session) await fakeBrowser.storage.session.set(session);
      stubTab(PAGE, async () => ({ active: false }));
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      await openPopup();
      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));

      toolbarToggle().click();

      await vi.waitFor(() => expect(close).toHaveBeenCalled());
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual(saved);
      await expect(fakeBrowser.storage.local.get(null)).resolves.toEqual({});
      expect(byId('status').textContent).toBe('');
    });

    it('keeps the popup open and says so when the set is rejected', async () => {
      startBackground();
      stubTab(PAGE, async () => ({ active: false }));
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      await openPopup();
      await vi.waitFor(() => expect(toolbarToggle().disabled).toBe(false));
      vi.spyOn(browser.storage.session, 'set').mockRejectedValue(new Error('Storage failed'));

      toolbarToggle().click();

      await vi.waitFor(() => expect(byId('status').textContent).toBe(TOOLBAR_SAVE_ERROR));
      expect(close).not.toHaveBeenCalled();
      expect(toolbarToggle().getAttribute('aria-checked')).toBe('false');
    });

    it.each([
      ['a browser page', 'chrome://extensions/', [], async () => ({ active: false }), "Annotations can't run on this page."],
      ['a site turned off in Options', PAGE, ['other.example'], async () => ({ active: false }), 'Annotations are turned off for this site in Options.'],
      ['a page whose content script does not answer', PAGE, [], () => Promise.reject(new Error('Receiving end does not exist.')), RELOAD],
    ])('stays disabled on %s, where Start annotating is disabled, and reads no state', async (_name, url, allowlist, reply, status) => {
      await writePolicy({ enabled: true, allowlist });
      const send = vi.spyOn(browser.runtime, 'sendMessage');
      stubTab(url, reply);
      await openPopup();

      await vi.waitFor(() => expect(byId('status').textContent).toBe(status));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(toolbarToggle().disabled).toBe(true);
      expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('shortcut hint', () => {
    const UNSET = "No keyboard shortcut is set; you can add one in your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager).";

    const stubShortcut = (shortcut?: string) =>
      vi.spyOn(browser.commands, 'getAll').mockResolvedValue([
        { name: '_execute_action', shortcut: 'Alt+P' },
        { name: 'capture.toggle', shortcut },
      ] as never);

    const stubCreate = () => vi.spyOn(browser.tabs, 'create').mockResolvedValue({} as never);

    it('names a set shortcut and describes the toggle with it', async () => {
      stubShortcut('Alt+Q');
      const create = stubCreate();
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(byId('shortcut-hint').textContent).toBe('Shortcut: Alt+Q'));
      expect(byId('shortcut-hint').hidden).toBe(false);
      expect(byId('shortcut-hint').childElementCount).toBe(1);
      expect(byId('shortcut-hint').firstElementChild?.tagName).toBe('KBD');
      expect(byId('toggle').getAttribute('aria-describedby')).toBe('shortcut-hint');
      expect(create).not.toHaveBeenCalled();
    });

    it('points to the shortcut settings in plain text when no shortcut is set', async () => {
      stubShortcut();
      const create = stubCreate();
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(byId('shortcut-hint').textContent).toBe(UNSET));
      expect(byId('shortcut-hint').hidden).toBe(false);
      expect(byId('shortcut-hint').childElementCount).toBe(0);
      expect(byId('toggle').getAttribute('aria-describedby')).toBe('shortcut-hint');
      expect(create).not.toHaveBeenCalled();
    });

    it('leaves the hint empty and hidden, describing nothing, when the read rejects', async () => {
      const getAll = vi.spyOn(browser.commands, 'getAll').mockRejectedValue(new Error('no commands'));
      const create = stubCreate();
      stubTab(PAGE, async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(byId<HTMLButtonElement>('toggle').disabled).toBe(false));
      await vi.waitFor(() => expect(getAll).toHaveBeenCalledOnce());
      await Promise.resolve();
      expect(byId('shortcut-hint').textContent).toBe('');
      expect(byId('shortcut-hint').hidden).toBe(true);
      expect(byId('shortcut-hint').childElementCount).toBe(0);
      expect(byId('toggle').hasAttribute('aria-describedby')).toBe(false);
      expect(create).not.toHaveBeenCalled();
    });

    it('still names the shortcut on a page the extension cannot run on', async () => {
      stubShortcut('Alt+Q');
      const create = stubCreate();
      stubTab('chrome://extensions/', async () => ({ active: false }));
      await openPopup();

      await vi.waitFor(() => expect(byId('shortcut-hint').textContent).toBe('Shortcut: Alt+Q'));
      expect(byId('status').textContent).toBe("Annotations can't run on this page.");
      expect(byId('shortcut-hint').hidden).toBe(false);
      expect(byId('shortcut-hint').childElementCount).toBe(1);
      expect(byId('shortcut-hint').firstElementChild?.tagName).toBe('KBD');
      expect(create).not.toHaveBeenCalled();
    });
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
