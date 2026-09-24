import { browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { listAnnotations } from './annotation-storage';
import { registerBackgroundMessageHandlers } from './wiring/background-messages';
import type { BlobStore } from './blob-store';
import {
  annotationWriteError,
  isAnnotationWriteMessage,
  MAX_LIST_LENGTH,
  MAX_TEXT_LENGTH,
  isAttachmentMetadata,
  isCssEdit,
  isCssEdits,
  isScreenshotMetadata,
  sendAnnotationWrite,
  sendBackgroundRequest,
} from './annotation-messages';

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
  async put(): Promise<void> {}
  async get(): Promise<Blob | undefined> { return undefined; }
  async delete(): Promise<void> {}
}

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  registerBackgroundMessageHandlers({ blobStore: new MemoryBlobStore() });
});

describe('annotation write messages', () => {
  it('rejects attachments on add and update, and validates status values', () => {
    expect(isAnnotationWriteMessage({
      type: 'annotation.add', pageUrl, input: { note: 'x', selector: '#target', elementContext, attachments: [] },
    })).toBe(false);
    expect(isAnnotationWriteMessage({
      type: 'annotation.update', pageUrl, id: 'annotation-1', changes: { attachments: [] },
    })).toBe(false);
    expect(isAnnotationWriteMessage({
      type: 'annotation.update', pageUrl, id: 'annotation-1', changes: { status: 'resolved' },
    })).toBe(true);
    expect(isAnnotationWriteMessage({
      type: 'annotation.update', pageUrl, id: 'annotation-1', changes: { status: 'closed' },
    })).toBe(false);
  });

  it('validates optional screenshot changes without weakening existing updates', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { screenshot: 'data:image/png;base64,shot' },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { note: 'still valid', selector: '#target', elementContext },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.add',
        pageUrl,
        input: { note: 'with screenshot', selector: '#target', elementContext, screenshot: 5 },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.add',
        pageUrl,
        input: { note: 'valid', selector: '#target', elementContext },
      }),
    ).toBe(true);
  });

  it('validates attachment metadata and shared image limits', () => {
    expect(isAttachmentMetadata({ id: 'a', name: 'photo.png', mimeType: 'image/png', byteLength: 1 })).toBe(true);
    expect(isAttachmentMetadata({ id: 'a', name: ' ', mimeType: 'image/png', byteLength: 1 })).toBe(false);
    expect(isAttachmentMetadata({ id: 'a', name: ' photo.png', mimeType: 'image/png', byteLength: 1 })).toBe(false);
    expect(isAttachmentMetadata({ id: 'a', name: 'photo.png', mimeType: 'image/png', byteLength: 2 * 1024 * 1024 + 1 })).toBe(false);
    expect(isAttachmentMetadata({ id: 'a', name: 'photo.svg', mimeType: 'image/svg+xml', byteLength: 1 })).toBe(false);
  });

  it('validates screenshot metadata and supported MIME types', () => {
    expect(isScreenshotMetadata({ mimeType: 'image/webp', width: 800, height: 400, byteLength: 12 })).toBe(true);
    expect(isScreenshotMetadata({ mimeType: 'https://remote/image.png', width: 800, height: 400, byteLength: 12 })).toBe(false);
    expect(isScreenshotMetadata({ mimeType: 'image/png', width: 0, height: 400, byteLength: 12 })).toBe(false);
    expect(isScreenshotMetadata({ mimeType: 'image/png', width: 800, height: 400, byteLength: -1 })).toBe(false);
  });

  it('accepts complete contexts and rejects incomplete write contexts', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.add',
        pageUrl,
        input: { note: 'valid context', selector: '#target', elementContext },
      }),
    ).toBe(true);

    const { boundingBox: _boundingBox, ...missingField } = elementContext;
    const invalidContexts = [
      missingField,
      { ...elementContext, classList: 'primary' },
      { ...elementContext, sourcePath: { lineNumber: 42 } },
    ];
    for (const invalidContext of invalidContexts) {
      expect(
        isAnnotationWriteMessage({
          type: 'annotation.add',
          pageUrl,
          input: { note: 'invalid context', selector: '#target', elementContext: invalidContext },
        }),
      ).toBe(false);
    }
  });

  it('validates css edit shapes without weakening existing updates', () => {
    expect(isCssEdit({ property: 'color', value: 'red', original: 'blue' })).toBe(true);
    expect(isCssEdit({ property: 'color' })).toBe(false);
    expect(isCssEdit({ property: 'color', value: 'red' })).toBe(false);
    expect(isCssEdit({ property: 'color', value: 'red', original: 1 })).toBe(false);
    expect(isCssEdits([{ property: 'color', value: 'red', original: 'blue' }])).toBe(true);
    expect(isCssEdits('nope')).toBe(false);
    expect(isCssEdits([{ property: 'color' }])).toBe(false);
    expect(isCssEdits([{ property: 1, value: 'red' }])).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: [{ property: 'color', value: 'red', original: 'blue' }] },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: [{ property: 'color', value: 'red' }] },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: 'nope' },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: [{ property: 'color' }] },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: [{ property: 1, value: 'red' }] },
      }),
    ).toBe(false);
  });

  it('accepts valid repro updates and rejects invalid repro shapes', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { repro: { steps: ['a', 'b'], expected: 'x', actual: 'y' } },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { repro: { steps: 'nope', expected: 'x', actual: 'y' } },
      }),
    ).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { repro: { steps: ['a'], expected: 5, actual: 'y' } },
      }),
    ).toBe(false);
  });

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

  it('routes mutations through the background write owner', async () => {
    const created = await sendAnnotationWrite({
      type: 'annotation.add',
      pageUrl,
      input: { note: 'Created through the worker', selector: '#target', elementContext },
    });

    expect(await listAnnotations(pageUrl)).toEqual([created]);

    const updated = await sendAnnotationWrite({
      type: 'annotation.update',
      pageUrl,
      id: created.id,
      changes: { note: 'Updated through the worker' },
    });
    expect(updated).toMatchObject({ id: created.id, note: 'Updated through the worker' });

    await expect(
      sendAnnotationWrite({ type: 'annotation.delete', pageUrl, id: created.id }),
    ).resolves.toBe(true);
    await expect(listAnnotations(pageUrl)).resolves.toEqual([]);
  });

  it('rejects when the background returns a write error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'storage unavailable' } as never);
    await expect(sendAnnotationWrite({ type: 'annotation.clear', pageUrl })).rejects.toThrow('storage unavailable');
  });
});

describe('shared caps on write messages', () => {
  const cap = 'x'.repeat(MAX_TEXT_LENGTH);
  const over = 'x'.repeat(MAX_TEXT_LENGTH + 1);
  const list = (length: number) => Array.from({ length }, () => 'x');
  const add = (input: Record<string, unknown>, url = pageUrl) => ({
    type: 'annotation.add', pageUrl: url, input: { note: 'n', selector: '#target', elementContext, ...input },
  });
  const update = (changes: Record<string, unknown>) => ({ type: 'annotation.update', pageUrl, id: 'annotation-1', changes });

  it('accepts every text field at the text cap and every list at the list cap', () => {
    for (const message of [
      add({ note: cap }),
      add({ selector: cap }),
      add({}, `https://example.com/${'x'.repeat(MAX_TEXT_LENGTH - 'https://example.com/'.length)}`),
      add({ elementContext: { ...elementContext, text: cap, classList: list(MAX_LIST_LENGTH) } }),
      add({ repro: { steps: list(MAX_LIST_LENGTH), expected: cap, actual: cap } }),
      add({ cssEdits: Array.from({ length: MAX_LIST_LENGTH }, () => ({ property: cap, value: cap, original: cap })) }),
      update({ note: cap }),
    ]) {
      expect(annotationWriteError(message)).toBeUndefined();
      expect(isAnnotationWriteMessage(message)).toBe(true);
    }
  });

  it('refuses one past any cap and says which field was too long', () => {
    const limits = `each text is at most ${MAX_TEXT_LENGTH} characters and each list at most ${MAX_LIST_LENGTH} items`;
    const cases: [unknown, string][] = [
      [add({ note: over }), `The note is longer than ${MAX_TEXT_LENGTH} characters.`],
      [update({ note: over }), `The note is longer than ${MAX_TEXT_LENGTH} characters.`],
      [add({ selector: over }), `The selector is longer than ${MAX_TEXT_LENGTH} characters.`],
      [add({}, over), `The page URL is longer than ${MAX_TEXT_LENGTH} characters.`],
      [{ type: 'annotation.clear', pageUrl: over }, `The page URL is longer than ${MAX_TEXT_LENGTH} characters.`],
      [add({ elementContext: { ...elementContext, url: over } }), `The element details are not valid: ${limits}.`],
      [add({ elementContext: { ...elementContext, classList: list(MAX_LIST_LENGTH + 1) } }), `The element details are not valid: ${limits}.`],
      [add({ elementContext: { ...elementContext, sourcePath: { fileName: over } } }), `The element details are not valid: ${limits}.`],
      [update({ repro: { steps: [], expected: over, actual: '' } }), `The reproduction steps are not valid: ${limits}.`],
      [update({ repro: { steps: list(MAX_LIST_LENGTH + 1), expected: '', actual: '' } }), `The reproduction steps are not valid: ${limits}.`],
      [update({ cssEdits: [{ property: 'color', value: over, original: '' }] }), `The CSS edits are not valid: ${limits}.`],
      [update({ cssEdits: Array.from({ length: MAX_LIST_LENGTH + 1 }, () => ({ property: 'a', value: 'b', original: 'c' })) }), `The CSS edits are not valid: ${limits}.`],
    ];
    for (const [message, reason] of cases) {
      expect(annotationWriteError(message)).toBe(reason);
      expect(isAnnotationWriteMessage(message)).toBe(false);
    }
  });

  it('holds ids to the shared id grammar and names malformed messages', () => {
    expect(isAnnotationWriteMessage({ type: 'annotation.delete', pageUrl, id: 'a'.repeat(64) })).toBe(true);
    expect(annotationWriteError({ type: 'annotation.delete', pageUrl, id: 'a'.repeat(65) })).toBe('The annotation id is not valid.');
    expect(annotationWriteError({ type: 'annotation.update', pageUrl, id: 'a b', changes: {} })).toBe('The annotation id is not valid.');
    expect(annotationWriteError({ type: 'annotation.add', pageUrl })).toBe('The annotation change is not valid.');
    expect(annotationWriteError({ type: 'annotation.add', pageUrl: 3, input: {} })).toBe('The page URL is missing.');
  });

  it('refuses a blank note on add and on an update that sets one', () => {
    for (const note of ['', '   ', '\n\t ']) {
      expect(annotationWriteError({ type: 'annotation.add', pageUrl, input: { note, selector: '#target', elementContext } })).toBe('The note is empty.');
      expect(annotationWriteError({ type: 'annotation.update', pageUrl, id: 'annotation-1', changes: { note } })).toBe('The note is empty.');
    }
    expect(isAnnotationWriteMessage({ type: 'annotation.update', pageUrl, id: 'annotation-1', changes: { status: 'resolved' } })).toBe(true);
  });

  it('accepts only http, https and file page URLs on every write', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'about:blank', 'ftp://example.com/', 'chrome-extension://abc/page.html', 'not a url']) {
      expect(annotationWriteError({ type: 'annotation.clear', pageUrl: bad }), bad).toBe('The page URL is not an http, https or file URL.');
      expect(annotationWriteError({ type: 'annotation.add', pageUrl: bad, input: { note: 'x', selector: '#target', elementContext } }), bad)
        .toBe('The page URL is not an http, https or file URL.');
    }
    for (const good of ['http://example.com/', pageUrl, 'file:///tmp/page.html']) {
      expect(annotationWriteError({ type: 'annotation.clear', pageUrl: good }), good).toBeUndefined();
    }
  });

  it('answers a javascript: page URL with an error response and stores nothing', async () => {
    const bad = 'javascript:alert(1)';
    await expect(sendAnnotationWrite({ type: 'annotation.add', pageUrl: bad, input: { note: 'x', selector: '#target', elementContext } }))
      .rejects.toThrow('The page URL is not an http, https or file URL.');
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual([]);
  });

  it('answers an over-cap write with an error response and stores nothing', async () => {
    await expect(sendAnnotationWrite(add({ note: over }) as never)).rejects.toThrow(
      `The note is longer than ${MAX_TEXT_LENGTH} characters.`,
    );
    await expect(listAnnotations(pageUrl)).resolves.toEqual([]);
  });
});

describe('sendBackgroundRequest', () => {
  const isNumber = (value: unknown): value is number => typeof value === 'number';

  it('throws the text of an error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'storage unavailable' } as never);
    await expect(sendBackgroundRequest({ type: 'probe' }, isNumber, 'Invalid probe response')).rejects.toThrow('storage unavailable');
  });

  it('throws invalidError for a response failing the guard', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue('not a number' as never);
    await expect(sendBackgroundRequest({ type: 'probe' }, isNumber, 'Invalid probe response')).rejects.toThrow('Invalid probe response');
  });

  it('resolves to a valid response and sends the message unchanged', async () => {
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(42 as never);
    await expect(sendBackgroundRequest({ type: 'probe' }, isNumber, 'Invalid probe response')).resolves.toBe(42);
    expect(send).toHaveBeenCalledWith({ type: 'probe' });
  });
});
