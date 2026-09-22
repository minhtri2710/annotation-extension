import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { isAnnotationWriteMessage, sendAnnotationWrite } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';

const pageUrl = 'https://example.com/message-test';
const elementContext = {
  selector: '#target',
  tagName: 'BUTTON',
  id: 'target',
  classList: ['primary'],
  text: 'Target',
  boundingBox: { x: 1, y: 2, width: 100, height: 40 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  background.main();
});

describe('background message routing', () => {
  it('answers a rejected storage mutation with an error response', async () => {
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('storage unavailable'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'annotation.add',
        pageUrl,
        input: { note: 'failed write', selector: '#target', elementContext },
      },
      {},
      sendResponse,
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'storage unavailable' }),
    );
  });

  it('routes successful writes without changing their response type', async () => {
    const sendResponse = vi.fn();
    const message = {
      type: 'annotation.add' as const,
      pageUrl,
      input: { note: 'created', selector: '#target', elementContext },
    };

    await fakeBrowser.runtime.onMessage.trigger(message, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({ note: 'created' });
    expect(isAnnotationWriteMessage(message)).toBe(true);
    await expect(listAnnotations(pageUrl)).resolves.toHaveLength(1);
  });

  it('passes a sender tab window id to captureVisibleTab', async () => {
    const captureVisibleTab = vi
      .spyOn(browser.tabs, 'captureVisibleTab')
      .mockResolvedValue('data:image/png;base64,capture' as never);
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture' },
      {
        tab: {
          index: 0,
          pinned: false,
          highlighted: false,
          windowId: 42,
          active: true,
          frozen: false,
          incognito: false,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          lastAccessed: 0,
        },
      },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith('data:image/png;base64,capture'));
    expect(captureVisibleTab).toHaveBeenCalledWith(42);
  });

  it('answers a rejected visible-tab capture with an error response', async () => {
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockRejectedValue(new Error('capture denied'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture' },
      {
        tab: {
          index: 0,
          pinned: false,
          highlighted: false,
          windowId: 42,
          active: true,
          frozen: false,
          incognito: false,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          lastAccessed: 0,
        },
      },
      sendResponse,
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'capture denied' }),
    );
  });
});
