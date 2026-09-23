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
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7 }] as never);
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

    for (const listener of commandListeners) await listener('some-other-command');
    expect(sendMessage.mock.calls).toEqual([]);

    for (const listener of commandListeners) await listener('capture.toggle');
    expect(sendMessage.mock.calls).toEqual([[7, { type: 'capture.toggle' }]]);
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
});
