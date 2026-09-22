import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pageKey } from '../utils/page-key';
import {
  addAnnotation,
  clearAnnotations,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
} from './annotation-storage';
import type { AnnotationInput } from './annotation';

const firstPage = 'https://example.com/docs?mode=full#intro';
const secondPage = 'https://example.com/other';
const firstInput: AnnotationInput = {
  note: 'Check this heading',
  selector: 'main h1',
  elementContext: { tagName: 'H1', text: 'Documentation' },
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('annotation storage', () => {
  it('adds an annotation and lists it for its page', async () => {
    const created = await addAnnotation(firstPage, firstInput);

    expect(created).toMatchObject({
      pageUrl: firstPage,
      note: firstInput.note,
      selector: firstInput.selector,
      elementContext: firstInput.elementContext,
    });
    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.updatedAt).toEqual(created.createdAt);
    expect(await listAnnotations(firstPage)).toEqual([created]);

    const stored = await fakeBrowser.storage.local.get(pageKey(firstPage));
    expect(stored[pageKey(firstPage)]).toEqual([created]);
  });

  it('returns an empty list for an unseen page', async () => {
    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
  });

  it('keeps pages isolated while ignoring URL fragments in the key', async () => {
    const first = await addAnnotation(firstPage, firstInput);
    const second = await addAnnotation(secondPage, {
      ...firstInput,
      note: 'A different page',
    });

    await expect(listAnnotations('https://example.com/docs?mode=full#another-section')).resolves.toEqual([
      first,
    ]);
    await expect(listAnnotations(secondPage)).resolves.toEqual([second]);
  });

  it('updates by id, changes the field, and strictly bumps updatedAt', async () => {
    const created = await addAnnotation(firstPage, firstInput);

    const updated = await updateAnnotation(firstPage, created.id, {
      note: 'Updated note',
    });

    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      ...created,
      note: 'Updated note',
      updatedAt: expect.any(String),
    });
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    await expect(listAnnotations(firstPage)).resolves.toEqual([updated]);
  });

  it('treats an update for a missing id as a null no-op', async () => {
    await expect(
      updateAnnotation(firstPage, 'missing-id', { note: 'Should not be stored' }),
    ).resolves.toBeNull();
    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
  });

  it('deletes only the requested annotation', async () => {
    const first = await addAnnotation(firstPage, firstInput);
    const second = await addAnnotation(firstPage, {
      ...firstInput,
      note: 'Keep this one',
    });

    await expect(deleteAnnotation(firstPage, first.id)).resolves.toBe(true);
    await expect(listAnnotations(firstPage)).resolves.toEqual([second]);
    await expect(deleteAnnotation(firstPage, first.id)).resolves.toBe(false);
  });

  it('clears one page without affecting another page', async () => {
    await addAnnotation(firstPage, firstInput);
    const otherPageAnnotation = await addAnnotation(secondPage, firstInput);

    await clearAnnotations(firstPage);

    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
    await expect(listAnnotations(secondPage)).resolves.toEqual([otherPageAnnotation]);
  });

  it('serializes concurrent additions for one page without losing data', async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        addAnnotation(firstPage, {
          ...firstInput,
          note: `Concurrent note ${index}`,
        }),
      ),
    );

    const stored = await listAnnotations(firstPage);
    expect(stored).toHaveLength(created.length);
    expect(new Set(stored.map((annotation) => annotation.id)).size).toBe(created.length);
    expect(stored).toEqual(expect.arrayContaining(created));
  });
});
