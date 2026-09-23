import { browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { registerBackgroundMessageHandlers } from './background-messages';
import { isAnnotationWriteMessage, MAX_TEXT_LENGTH } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { BlobStore } from '../blob-store';

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

class MemoryBlobStore implements BlobStore {
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

/** Real signatures, so the image gate accepts the fixture bytes. */
const PNG = '\x89PNG\r\n\x1a\n';
const WEBP = 'RIFF\0\0\0\0WEBP';

function start(store: MemoryBlobStore, processor = vi.fn().mockResolvedValue({
  blob: new Blob([WEBP + 'processed'], { type: 'image/webp' }),
  width: 800,
  height: 400,
})) {
  fakeBrowser.reset();
  registerBackgroundMessageHandlers({ blobStore: store, screenshotProcessor: processor });
  return processor;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

function captureFailed(reason: string) {
  return { ok: false, error: reason, failure: { kind: 'failed', reason } };
}

const captureMessage = {
  type: 'screenshot.capture',
  pageUrl,
  annotationId: 'annotation-1',
  rect: elementContext.boundingBox,
  devicePixelRatio: 2,
};

function stubCommands(shortcut: string) {
  return vi.spyOn(browser.commands, 'getAll').mockResolvedValue([
    { name: 'capture.toggle', description: 'Toggle annotation capture mode', shortcut },
  ] as never);
}

describe('background message routing', () => {
  it('answers a rejected storage mutation with an error response', async () => {
    const store = new MemoryBlobStore();
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

  it('answers an over-cap or malformed annotation write with an error response and writes nothing', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const cases: [unknown, string][] = [
      [
        { type: 'annotation.add', pageUrl, input: { note: 'n'.repeat(MAX_TEXT_LENGTH + 1), selector: '#target', elementContext } },
        `The note is longer than ${MAX_TEXT_LENGTH} characters.`,
      ],
      [{ type: 'annotation.add', pageUrl }, 'The annotation change is not valid.'],
      [{ type: 'annotation.delete', pageUrl, id: 7 }, 'The annotation id is not valid.'],
    ];
    for (const [message, error] of cases) {
      const sendResponse = vi.fn();
      const handled = await fakeBrowser.runtime.onMessage.trigger(message, {}, sendResponse);
      expect(handled).toContain(true);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error });
    }
    await expect(listAnnotations(pageUrl)).resolves.toEqual([]);
  });

  it('routes successful writes without changing their response type', async () => {
    const store = new MemoryBlobStore();
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
    const store = new MemoryBlobStore();
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
    const store = new MemoryBlobStore();
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
      expect(sendResponse).toHaveBeenCalledWith(captureFailed('capture denied')),
    );
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
  });

  it('captures in the background, stores a blob, and updates metadata only', async () => {
    const store = new MemoryBlobStore();
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

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ mimeType: 'image/webp', width: 800, height: 400, byteLength: 21 }));
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(42);
    expect(processor).toHaveBeenCalledWith('data:image/png;base64,capture', elementContext.boundingBox, 2);
    expect(await store.get(`screenshot:${created.id}`)).toBeDefined();
    const stored = await browser.storage.local.get(`page:${new URL(pageUrl).host}`);
    expect(JSON.stringify(stored)).not.toContain('processed');
  });

  it('removes a first-capture Blob when metadata persistence fails', async () => {
    const store = new MemoryBlobStore();
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

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(captureFailed('metadata unavailable')));
    expect(await store.get(`screenshot:${created.id}`)).toBeUndefined();
    const [stored] = await listAnnotations(pageUrl);
    expect(stored?.id).toBe(created.id);
    expect(stored).not.toHaveProperty('screenshot');
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('preserves the metadata error when first-capture cleanup fails', async () => {
    const store = new MemoryBlobStore();
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
    vi.spyOn(store, 'delete').mockRejectedValue(new Error('cleanup unavailable'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
      captureFailed('metadata unavailable; cleanup failed: cleanup unavailable'),
    ));
  });

  it('restores the previous Blob when re-capture metadata persistence fails', async () => {
    const store = new MemoryBlobStore();
    const processor = start(store);
    processor
      .mockResolvedValueOnce({ blob: new Blob([WEBP + 'old'], { type: 'image/webp' }), width: 800, height: 400 })
      .mockResolvedValueOnce({ blob: new Blob([WEBP + 'new'], { type: 'image/webp' }), width: 640, height: 320 });
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
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledWith({ mimeType: 'image/webp', width: 800, height: 400, byteLength: 15 }));
    const oldBlob = await store.get(`screenshot:${created.id}`);
    expect(oldBlob).toBeDefined();

    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('metadata unavailable'));
    const secondResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      secondResponse,
    );

    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledWith(captureFailed('metadata unavailable')));
    const restoredBlob = await store.get(`screenshot:${created.id}`);
    expect(restoredBlob).toBe(oldBlob);
    expect(await restoredBlob?.text()).toBe(WEBP + 'old');
    await expect(listAnnotations(pageUrl)).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        screenshot: { mimeType: 'image/webp', width: 800, height: 400, byteLength: 15 },
      }),
    ]);
  });

  it('preserves the not-found error when cleanup fails', async () => {
    const store = new MemoryBlobStore();
    const processor = start(store);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    vi.spyOn(store, 'delete').mockRejectedValue(new Error('cleanup unavailable'));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: 'missing', rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
      captureFailed('Annotation was not found for screenshot capture; cleanup failed: cleanup unavailable'),
    ));
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('answers read requests with transport-safe bytes', async () => {
    const store = new MemoryBlobStore();
    start(store);
    await store.put('screenshot:annotation-1', new Blob(['read-me'], { type: 'image/png' }));
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger({ type: 'blob.read', key: 'screenshot:annotation-1' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ mimeType: 'image/png', base64: btoa('read-me') }));
  });

  it('reads both blob key kinds and rejects foreign keys', async () => {
    const store = new MemoryBlobStore();
    start(store);
    await store.put('screenshot:one', new Blob(['shot'], { type: 'image/png' }));
    await store.put('attachment:one', new Blob(['attach'], { type: 'image/jpeg' }));
    const screenshotResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'blob.read', key: 'screenshot:one' }, {}, screenshotResponse);
    await vi.waitFor(() => expect(screenshotResponse).toHaveBeenCalledWith({ mimeType: 'image/png', base64: btoa('shot') }));
    const attachmentResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'blob.read', key: 'attachment:one' }, {}, attachmentResponse);
    await vi.waitFor(() => expect(attachmentResponse).toHaveBeenCalledWith({ mimeType: 'image/jpeg', base64: btoa('attach') }));
    const foreignResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'blob.read', key: 'foreign:one' }, {}, foreignResponse);
    expect(foreignResponse).toHaveBeenCalledWith({ ok: false, error: 'Invalid blob key' });
  });

  it('adds and deletes an attachment through the background owner', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } }, {}, createdResponse);
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    const addResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'attachment.add', pageUrl, annotationId: created.id, name: 'photo.png', mimeType: 'image/png', base64: btoa(PNG + 'bytes') }, {}, addResponse);
    await vi.waitFor(() => expect(addResponse).toHaveBeenCalledWith(expect.objectContaining({ name: 'photo.png', mimeType: 'image/png', byteLength: 13 })));
    const attachment = addResponse.mock.calls[0]?.[0] as { id: string };
    expect(await store.get(`attachment:${attachment.id}`)).toBeDefined();
    const deleteResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'attachment.delete', pageUrl, annotationId: created.id, attachmentId: attachment.id }, {}, deleteResponse);
    await vi.waitFor(() => expect(deleteResponse).toHaveBeenCalledWith(true));
    expect(await store.get(`attachment:${attachment.id}`)).toBeUndefined();
  });

  it('refuses attachment bytes that are not the declared type and stores nothing', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } }, {}, createdResponse);
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    const response = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'attachment.add', pageUrl, annotationId: created.id, name: 'shot.png', mimeType: 'image/png', base64: btoa('\xff\xd8\xff\xe0jpeg') }, {}, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false, error: 'Image bytes are not image/png.' }));
    expect(store.blobs.size).toBe(0);
    expect((await listAnnotations(pageUrl))[0]?.attachments).toBeUndefined();
  });

  it('refuses a processed screenshot whose bytes are not its type and stores nothing', async () => {
    const store = new MemoryBlobStore();
    start(store, vi.fn().mockResolvedValue({ blob: new Blob(['not webp'], { type: 'image/webp' }), width: 800, height: 400 }));
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } }, {}, createdResponse);
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalledTimes(1));
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    const response = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'screenshot.capture', pageUrl, annotationId: created.id, rect: elementContext.boundingBox, devicePixelRatio: 1 }, sender, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'Image bytes are not image/webp.' })));
    expect(store.blobs.size).toBe(0);
    expect((await listAnnotations(pageUrl))[0]?.screenshot).toBeUndefined();
  });

  it('rejects invalid attachments without leaving a Blob', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const response = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'attachment.add', pageUrl, annotationId: 'missing', name: 'x.svg', mimeType: 'image/svg+xml', base64: btoa('x') }, {}, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
    expect(store.blobs.size).toBe(0);
  });

  it('rejects bad MIME, oversized, empty, missing, and sixth attachments', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const sendAttachment = async (annotationId: string, name: string, mimeType: string, base64: string) => {
      const response = vi.fn();
      await fakeBrowser.runtime.onMessage.trigger(
        { type: 'attachment.add', pageUrl, annotationId, name, mimeType, base64 },
        {},
        response,
      );
      await vi.waitFor(() => expect(response).toHaveBeenCalled());
      return response.mock.calls[0]?.[0];
    };

    await expect(sendAttachment('missing', 'photo.png', 'image/png', btoa(PNG + 'data'))).resolves.toEqual(
      { ok: false, error: 'Annotation was not found' },
    );
    await expect(sendAttachment('missing', 'photo.svg', 'image/svg+xml', btoa('data'))).resolves.toMatchObject({ ok: false });
    await expect(sendAttachment('missing', 'empty.png', 'image/png', '')).resolves.toMatchObject({ ok: false });
    await expect(sendAttachment('missing', 'large.png', 'image/png', btoa('x'.repeat(2 * 1024 * 1024 + 1)))).resolves.toMatchObject({ ok: false });
    expect(store.blobs.size).toBe(0);

    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalled());
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    for (let index = 0; index < 5; index += 1) {
      await expect(sendAttachment(created.id, `photo-${index}.png`, 'image/png', btoa(`${PNG}data-${index}`))).resolves.toEqual(
        expect.objectContaining({ name: `photo-${index}.png` }),
      );
    }
    await expect(sendAttachment(created.id, 'sixth.png', 'image/png', btoa(PNG + 'sixth'))).resolves.toMatchObject({ ok: false });
    expect(store.blobs.size).toBe(5);
  });

  it('deletes an attachment Blob when metadata persistence fails', async () => {
    const store = new MemoryBlobStore();
    start(store);
    const createdResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'annotation.add', pageUrl, input: { note: 'created', selector: '#target', elementContext } },
      {},
      createdResponse,
    );
    await vi.waitFor(() => expect(createdResponse).toHaveBeenCalled());
    const created = createdResponse.mock.calls[0]?.[0] as { id: string };
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('metadata unavailable'));
    const response = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'attachment.add', pageUrl, annotationId: created.id, name: 'photo.png', mimeType: 'image/png', base64: btoa(PNG + 'data') },
      {},
      response,
    );
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false, error: 'metadata unavailable' }));
    expect(store.blobs.size).toBe(0);
  });

  it('surfaces processor and store failures as error responses', async () => {
    const store = new MemoryBlobStore();
    start(store, vi.fn().mockRejectedValue(new Error('decode failed')));
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockResolvedValue('data:image/png;base64,capture' as never);
    const sendResponse = vi.fn();

    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'screenshot.capture', pageUrl, annotationId: 'missing', rect: elementContext.boundingBox, devicePixelRatio: 1 },
      sender,
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(captureFailed('decode failed')));
  });

  describe('capture refused for lack of an activeTab or host grant', () => {
    const refusals = [
      ['Chrome', "Either the '<all_urls>' or 'activeTab' permission is required."],
      ['Firefox', 'Missing activeTab permission'],
      ['Firefox host', 'Missing host permission for the tab'],
    ];

    for (const [engine, refusal] of refusals) {
      it(`answers the ${engine} refusal with a needs-grant failure carrying the bound shortcut`, async () => {
        start(new MemoryBlobStore());
        vi.spyOn(browser.tabs, 'captureVisibleTab').mockRejectedValue(new Error(refusal));
        stubCommands('Alt+Shift+A');
        const sendResponse = vi.fn();

        await fakeBrowser.runtime.onMessage.trigger(captureMessage, sender, sendResponse);

        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
        const response = sendResponse.mock.calls[0]?.[0] as { error: string; failure: unknown };
        expect(response.failure).toEqual({ kind: 'needs-grant', shortcut: 'Alt+Shift+A' });
        expect(response.error).not.toContain(refusal);
      });
    }

    it('leaves the shortcut out when the command has none bound', async () => {
      start(new MemoryBlobStore());
      vi.spyOn(browser.tabs, 'captureVisibleTab').mockRejectedValue(
        new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
      );
      stubCommands('');
      const sendResponse = vi.fn();

      await fakeBrowser.runtime.onMessage.trigger(captureMessage, sender, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
      expect((sendResponse.mock.calls[0]?.[0] as { failure: unknown }).failure).toEqual({ kind: 'needs-grant' });
    });
  });
});
