import { browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { listAnnotations } from '../annotation-storage';

type CommandListener = (command: string) => Promise<void>;
let commandListeners: CommandListener[];

// Stub: fakeBrowser has no commands.onCommand (vitest.setup.ts installs a no-op); this one keeps the listeners.
function captureCommandListeners() {
  commandListeners = [];
  Object.defineProperty(fakeBrowser.commands, 'onCommand', {
    configurable: true,
    value: { addListener: (listener: CommandListener) => commandListeners.push(listener), removeListener: () => {} },
  });
}

const pageUrl = 'https://example.com/background-entry';

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  captureCommandListeners();
  background.main();
});

describe('background entrypoint', () => {
  it('sends the capture toggle command to the active tab and ignores other commands', async () => {
    const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7 }] as never);
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

    for (const listener of commandListeners) await listener('some-other-command');
    expect(sendMessage.mock.calls).toEqual([]);

    for (const listener of commandListeners) await listener('capture.toggle');
    expect(sendMessage.mock.calls).toEqual([[7, { type: 'capture.toggle' }]]);
    expect(query.mock.calls).toEqual([[{ active: true, currentWindow: true }]]);
  });

  it('routes an annotation write message to storage and answers with the stored annotation', async () => {
    const sendResponse = vi.fn();
    const elementContext = {
      selector: '#target',
      tagName: 'BUTTON',
      id: 'target',
      classList: [],
      text: 'Target',
      boundingBox: { x: 1, y: 2, width: 100, height: 40 },
      url: pageUrl,
      viewport: { width: 1280, height: 720 },
      sourcePath: null,
    };

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'routed note', selector: '#target', elementContext } },
      {},
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    const stored = await listAnnotations(pageUrl);
    expect(stored.map(({ note, selector }) => ({ note, selector }))).toEqual([{ note: 'routed note', selector: '#target' }]);
    expect(sendResponse.mock.calls[0]![0]).toMatchObject({ note: 'routed note', id: stored[0]!.id });
  });

  describe('toolbar tab state', () => {
    const KEY = (tabId: number) => `ui:toolbar-tab:${tabId}`;
    const fromContentScript = (tabId: number) => ({ tab: { id: tabId } });
    // A message reaches the background as it does from the popup (no tab) or from a content script (its own tab).
    async function send(message: unknown, sender: object = {}) {
      const sendResponse = vi.fn();
      await fakeBrowser.runtime.onMessage.trigger(message, sender, sendResponse);
      return sendResponse;
    }

    it('writes a set to storage.session under one key per tab and nothing to storage.local, and answers the state', async () => {
      const tabsSend = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

      const on = await send({ type: 'toolbar.set', tabId: 5, on: true });
      await vi.waitFor(() => expect(on).toHaveBeenCalledWith({ on: true }));
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({ [KEY(5)]: true });
      await expect(fakeBrowser.storage.local.get(null)).resolves.toEqual({});

      const off = await send({ type: 'toolbar.set', tabId: 5, on: false });
      await vi.waitFor(() => expect(off).toHaveBeenCalledWith({ on: false }));
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({});
      expect(tabsSend.mock.calls).toEqual([[5, { type: 'toolbar.changed', on: true }], [5, { type: 'toolbar.changed', on: false }]]);
    });

    it('answers a state request from the sending tab, and from the message tab id only for the popup', async () => {
      await fakeBrowser.storage.session.set({ [KEY(5)]: true });

      const own = await send({ type: 'toolbar.get', tabId: 6 }, fromContentScript(5));
      await vi.waitFor(() => expect(own).toHaveBeenCalledWith({ on: true }));
      const other = await send({ type: 'toolbar.get' }, fromContentScript(6));
      await vi.waitFor(() => expect(other).toHaveBeenCalledWith({ on: false }));
      const popup = await send({ type: 'toolbar.get', tabId: 5 });
      await vi.waitFor(() => expect(popup).toHaveBeenCalledWith({ on: true }));
    });

    it('sets the sending tab for a content script whatever tab id the message names', async () => {
      vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

      const set = await send({ type: 'toolbar.set', tabId: 6, on: true }, fromContentScript(5));

      await vi.waitFor(() => expect(set).toHaveBeenCalledWith({ on: true }));
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({ [KEY(5)]: true });
    });

    it('deletes the tab key when the tab closes and leaves the other tabs', async () => {
      await fakeBrowser.storage.session.set({ [KEY(5)]: true, [KEY(6)]: true });

      await fakeBrowser.tabs.onRemoved.trigger(5, { isWindowClosing: false, windowId: 1 });

      await vi.waitFor(async () => expect(await fakeBrowser.storage.session.get(null)).toEqual({ [KEY(6)]: true }));
    });

    it('still answers a set when the tab has no content script to tell', async () => {
      vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('Receiving end does not exist.'));

      const set = await send({ type: 'toolbar.set', tabId: 5, on: true });

      await vi.waitFor(() => expect(set).toHaveBeenCalledWith({ on: true }));
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({ [KEY(5)]: true });
    });

    it.each([
      ['a set with a non-boolean state', { type: 'toolbar.set', tabId: 5, on: 'yes' }, {}],
      ['a popup set with no tab id', { type: 'toolbar.set', on: true }, {}],
      ['a popup set with a negative tab id', { type: 'toolbar.set', tabId: -1, on: true }, {}],
      ['a popup set with a fractional tab id', { type: 'toolbar.set', tabId: 1.5, on: true }, {}],
      ['a popup set with a string tab id', { type: 'toolbar.set', tabId: '5', on: true }, {}],
      ['a popup state request with no tab id', { type: 'toolbar.get' }, {}],
      ['a change message sent to the background', { type: 'toolbar.changed', on: true }, fromContentScript(5)],
      ['a set of another type', { type: 'toolbar.put', tabId: 5, on: true }, {}],
    ])('changes and answers nothing for %s', async (_name, message, sender) => {
      const tabsSend = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

      const sendResponse = await send(message, sender);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendResponse).not.toHaveBeenCalled();
      expect(tabsSend).not.toHaveBeenCalled();
      await expect(fakeBrowser.storage.session.get(null)).resolves.toEqual({});
      await expect(fakeBrowser.storage.local.get(null)).resolves.toEqual({});
    });

    it('answers a failed write with an error response and does not tell the tab', async () => {
      const tabsSend = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);
      vi.spyOn(browser.storage.session, 'set').mockRejectedValue(new Error('Storage failed'));

      const set = await send({ type: 'toolbar.set', tabId: 5, on: true });

      await vi.waitFor(() => expect(set).toHaveBeenCalledWith({ ok: false, error: 'Storage failed' }));
      expect(tabsSend).not.toHaveBeenCalled();
    });
  });
});
