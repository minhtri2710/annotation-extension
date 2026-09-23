import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isAnnotationErrorResponse, isAnnotationWriteMessage } from '../annotation-messages';
import { isBlobReadMessage, isScreenshotCaptureMessage, sendBlobRead, sendScreenshotCapture } from './messages';

const captureMessage = {
  pageUrl: 'https://example.com/page',
  annotationId: 'annotation-1',
  rect: { x: 1, y: 2, width: 100, height: 40 },
  devicePixelRatio: 2,
};

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('screenshot messages', () => {
  it('guards capture and read messages', () => {
    expect(isScreenshotCaptureMessage({ type: 'screenshot.capture', ...captureMessage })).toBe(true);
    expect(isScreenshotCaptureMessage({ type: 'screenshot.capture' })).toBe(false);
    expect(isBlobReadMessage({ type: 'blob.read', key: 'screenshot:annotation-1' })).toBe(true);
    expect(isBlobReadMessage({ type: 'blob.read', key: 'foreign' })).toBe(false);
    expect(isScreenshotCaptureMessage(null)).toBe(false);
    expect(isScreenshotCaptureMessage('screenshot.capture')).toBe(false);
  });

  it('sends capture metadata requests and returns validated metadata', async () => {
    const metadata = { mimeType: 'image/webp', width: 800, height: 400, byteLength: 123 };
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(metadata as never);

    await expect(sendScreenshotCapture(captureMessage)).resolves.toEqual(metadata);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'screenshot.capture', ...captureMessage });
  });

  it('rejects capture errors and invalid responses', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'capture denied' } as never);
    await expect(sendScreenshotCapture(captureMessage)).rejects.toThrow('capture denied');

    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ mimeType: 'image/png' } as never);
    await expect(sendScreenshotCapture(captureMessage)).rejects.toThrow('Invalid screenshot metadata response');
  });

  it('round-trips blob.read bytes as a Blob', async () => {
    const bytes = btoa('screenshot-bytes');
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ mimeType: 'image/png', base64: bytes } as never);

    const blob = await sendBlobRead('screenshot:annotation-1');
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('screenshot-bytes');
  });

  it('keeps screenshot and annotation message guards disjoint', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl: 'https://example.com',
        id: 'annotation-1',
        changes: { screenshot: 'data:image/png;base64,shot' },
      }),
    ).toBe(false);
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

  it('rejects a malformed read response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'missing' } as never);
    await expect(sendBlobRead('screenshot:annotation-1')).rejects.toThrow('missing');
    expect(isAnnotationErrorResponse({ ok: false, error: 'missing' })).toBe(true);
  });
});
