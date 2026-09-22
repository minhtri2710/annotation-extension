import { browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { registerBackgroundMessageHandlers } from './background-messages';
import { isAnnotationWriteMessage } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { ScreenshotStore } from '../screenshot/store';

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

class MemoryScreenshotStore implements ScreenshotStore {
  readonly blobs = new Map<string, Blob>();
  async put(id: string, blob: Blob): Promise<void> { this.blobs.set(id, blob); }
  async get(id: string): Promise<Blob | undefined> { return this.blobs.get(id); }
  async delete(ids: string[]): Promise<void> { for (const id of ids) this.blobs.delete(id); }
}

const sender = {
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
};

function start(store: MemoryScreenshotStore, processor = vi.fn().mockResolvedValue({
  blob: new Blob(['processed'], { type: 'image/webp' }),
  width: 800,
  height: 400,
})) {
  fakeBrowser.reset();
  registerBackgroundMessageHandlers({ screenshotStore: store, screenshotProcessor: processor });
  return processor;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('background message routing', () => {
  it('answers a rejected storage mutation with an error response', async () => {
    const store = new MemoryScreenshotStore();
    start(store);
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('storage unavailable'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'failed write', selector: '#target', elementContext } },
      {},
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'storage unavailable' }));
  });

  it('routes successful writes without changing their response type', async () => {
    const store = new MemoryScreenshotStore();
    start(store);
    const sendResponse = vi.fn();
    const message = { type: 'annotation.add' as const, pageUrl, input: { note: 'created', selector: '#target', elementContext } };

    await fakeBrowser.runtime.onMessage.trigger(message, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({ note: 'created' });
    expect(isAnnotationWriteMessage(message)).toBe(true);
    await expect(listAnnotations(pageUrl)).resolves.toHaveLength(1);
  });

  it('passes a sender tab window id to captureVisibleTab', async () => {
    const store = new MemoryScreenshotStore();
    const processor = start(store);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'screenshot.capture',
        pageUrl,
        annotationId: created.id,
        rect: elementContext.boundingBox,
        devicePixelRatio: 2,
      },
      sender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
    expect(processor).toHaveBeenCalledWith('data:image/png;base64,capture', elementContext.boundingBox, 2);
  });

  it('answers a rejected visible-tab capture with an error response', async () => {
    const store = new MemoryScreenshotStore();
    start(store);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockRejectedValue(new Error('capture denied'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'screenshot.capture',
        pageUrl,
        annotationId: 'annotation-1',
        rect: elementContext.boundingBox,
        devicePixelRatio: 2,
      },
      sender,
      sendResponse,
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'capture denied' }),
    );
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
  });

  it('captures in the background, stores a blob, and updates metadata only', async () => {
    const store = new MemoryScreenshotStore();
    const processor = start(store);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };

    const sendResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 2 },
      sender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ mimeType: 'image/webp', width: 800, height: 400, byteLength: 9 }));
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
    expect(processor).toHaveBeenCalledWith('data:image/png;base64,capture', elementContext.boundingBox, 2);
    expect(await store.get(created.id)).toBeDefined();
    const stored = await browser.storage.local.get(`page:${new URL(pageUrl).host}`);
    expect(JSON.stringify(stored)).not.toContain('processed');
  });

  it('removes a first-capture Blob when metadata persistence fails', async () => {
    const store = new MemoryScreenshotStore();
    const processor = start(store);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('metadata unavailable'));

    const sendResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'metadata unavailable' }));
    expect(await store.get(created.id)).toBeUndefined();
    const [stored] = await listAnnotations(pageUrl);
    expect(stored?.id).toBe(created.id);
    expect(stored).not.toHaveProperty('screenshot');
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('restores the previous Blob when re-capture metadata persistence fails', async () => {
    const store = new MemoryScreenshotStore();
    const processor = start(store);
    processor
      .mockResolvedValueOnce({ blob: new Blob(['old'], { type: 'image/webp' }), width: 800, height: 400 })
      .mockResolvedValueOnce({ blob: new Blob(['new'], { type: 'image/webp' }), width: 640, height: 320 });
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };

    const firstResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      firstResponse,
    );
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledWith({ mimeType: 'image/webp', width: 800, height: 400, byteLength: 3 }));
    const oldBlob = await store.get(created.id);
    expect(oldBlob).toBeDefined();

    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('metadata unavailable'));
    const secondResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      secondResponse,
    );

    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledWith({ ok: false, error: 'metadata unavailable' }));
    const restoredBlob = await store.get(created.id);
    expect(restoredBlob).toBe(oldBlob);
    expect(await restoredBlob?.text()).toBe('old');
    await expect(listAnnotations(pageUrl)).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        screenshot: { mimeType: 'image/webp', width: 800, height: 400, byteLength: 3 },
      }),
    ]);
  });

  it('answers read requests with transport-safe bytes', async () => {
    const store = new MemoryScreenshotStore();
    start(store);
    await store.put('annotation-1', new Blob(['read-me'], { type: 'image/png' }));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger({ type: 'screenshot.read', annotationId: 'annotation-1' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ mimeType: 'image/png', base64: btoa('read-me') }));
  });

  it('surfaces processor and store failures as error responses', async () => {
    const store = new MemoryScreenshotStore();
    start(store, vi.fn().mockRejectedValue(new Error('decode failed')));
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: 'missing', rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'decode failed' }));
  });
});
