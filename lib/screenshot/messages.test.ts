import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { isAnnotationWriteMessage } from '../annotation-messages';
import { isScreenshotCaptureMessage, sendScreenshotCapture } from './messages';

describe('screenshot capture messages', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    background.main();
    vi.restoreAllMocks();
  });

  it('guards the exact capture message and rejects other values', () => {
    expect(isScreenshotCaptureMessage({ type: 'screenshot.capture' })).toBe(true);
    expect(isScreenshotCaptureMessage({ type: 'annotation.clear', pageUrl: 'https://example.com' })).toBe(
      false,
    );
    expect(isScreenshotCaptureMessage(null)).toBe(false);
    expect(isScreenshotCaptureMessage('screenshot.capture')).toBe(false);
  });

  it('sends the exact capture message and returns its data URL', async () => {
    const dataUrl = 'data:image/png;base64,visible-tab';
    const sendMessage = vi
      .spyOn(browser.runtime, 'sendMessage')
      .mockImplementation(() => Promise.resolve(dataUrl) as never);

    await expect(sendScreenshotCapture()).resolves.toBe(dataUrl);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'screenshot.capture' });
  });

  it('rejects when the background returns a capture error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({
      ok: false,
      error: 'capture denied',
    } as never);

    await expect(sendScreenshotCapture()).rejects.toThrow('capture denied');
  });

  it('routes capture requests to the background visible-tab API', async () => {
    const dataUrl = 'data:image/png;base64,background-capture';
    const captureVisibleTab = vi
      .spyOn(browser.tabs, 'captureVisibleTab')
      .mockImplementation(() => Promise.resolve(dataUrl) as never);

    await expect(sendScreenshotCapture()).resolves.toBe(dataUrl);
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
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
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
  });

  it('keeps screenshot and annotation message guards disjoint', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl: 'https://example.com',
        id: 'annotation-1',
        changes: { screenshot: 'data:image/png;base64,shot' },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl: 'https://example.com',
        id: 'annotation-1',
        changes: { screenshot: 5 },
      }),
    ).toBe(false);
    expect(isScreenshotCaptureMessage({ type: 'annotation.update' })).toBe(false);
  });
});
