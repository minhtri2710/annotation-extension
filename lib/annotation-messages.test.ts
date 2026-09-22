import { browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';
import { listAnnotations } from './annotation-storage';
import {
  isAnnotationWriteMessage,
  isCssEdit,
  isCssEdits,
  sendAnnotationWrite,
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

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  background.main();
});

describe('annotation write messages', () => {
  it('validates optional screenshot changes without weakening existing updates', () => {
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { screenshot: 'data:image/png;base64,shot' },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { screenshot: 5 },
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
        input: {
          note: 'with screenshot',
          selector: '#target',
          elementContext,
          screenshot: 'data:image/png;base64,shot',
        },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.add',
        pageUrl,
        input: {
          note: 'bad screenshot',
          selector: '#target',
          elementContext,
          screenshot: 5,
        },
      }),
    ).toBe(false);
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
    expect(isCssEdit({ property: 'color', value: 'red' })).toBe(true);
    expect(isCssEdit({ property: 'color' })).toBe(false);
    expect(isCssEdits([{ property: 'color', value: 'red' }])).toBe(true);
    expect(isCssEdits('nope')).toBe(false);
    expect(isCssEdits([{ property: 'color' }])).toBe(false);
    expect(isCssEdits([{ property: 1, value: 'red' }])).toBe(false);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.update',
        pageUrl,
        id: 'annotation-1',
        changes: { cssEdits: [{ property: 'color', value: 'red' }] },
      }),
    ).toBe(true);
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

  it('rejects when the background returns a write error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({
      ok: false,
      error: 'storage unavailable',
    } as never);

    await expect(
      sendAnnotationWrite({
        type: 'annotation.clear',
        pageUrl,
      }),
    ).rejects.toThrow('storage unavailable');
  });

  it('routes mutations through the background write owner', async () => {
    const created = await sendAnnotationWrite({
      type: 'annotation.add',
      pageUrl,
      input: {
        note: 'Created through the worker',
        selector: '#target',
        elementContext,
      },
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
});
