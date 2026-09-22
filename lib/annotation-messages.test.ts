import { beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(() => {
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
        changes: { note: 'still valid', selector: '#target', elementContext: { tagName: 'BUTTON' } },
      }),
    ).toBe(true);
    expect(
      isAnnotationWriteMessage({
        type: 'annotation.add',
        pageUrl,
        input: {
          note: 'with screenshot',
          selector: '#target',
          elementContext: { tagName: 'BUTTON' },
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
          elementContext: { tagName: 'BUTTON' },
          screenshot: 5,
        },
      }),
    ).toBe(false);
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

  it('routes mutations through the background write owner', async () => {
    const created = await sendAnnotationWrite({
      type: 'annotation.add',
      pageUrl,
      input: {
        note: 'Created through the worker',
        selector: '#target',
        elementContext: { tagName: 'BUTTON' },
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
