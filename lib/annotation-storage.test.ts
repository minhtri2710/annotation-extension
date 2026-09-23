import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pageKey } from '../utils/page-key';
import {
  addAnnotation,
  addAnnotationWithScreenshot,
  clearAnnotations,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
  addAttachment,
  deleteAttachment,
  restoreAnnotation,
} from './annotation-storage';
import type { Annotation, AnnotationInput } from './annotation';
import type { BlobStore } from './blob-store';
import { attachmentKey, screenshotKey } from './blob-store';

const firstPage = 'https://example.com/docs?mode=full#intro';
const secondPage = 'https://example.com/other';
const firstInput: AnnotationInput = {
  note: 'Check this heading',
  selector: 'main h1',
  elementContext: {
    selector: 'main h1',
    tagName: 'H1',
    id: '',
    classList: [],
    text: 'Documentation',
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    url: firstPage,
    viewport: { width: 1280, height: 720 },
    sourcePath: null,
  },
};

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Blob>();
  failDelete = false;

  async put(key: string, blob: Blob): Promise<void> {
    this.blobs.set(key, blob);
  }

  async get(key: string): Promise<Blob | undefined> {
    return this.blobs.get(key);
  }

  async delete(keys: string[]): Promise<void> {
    if (this.failDelete) throw new Error('screenshot delete failed');
    for (const key of keys) this.blobs.delete(key);
  }
}

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
    expect(JSON.stringify(stored)).not.toContain('data:');
    expect(JSON.stringify(stored)).not.toContain('blob:');
  });

  it('stores screenshot bytes separately and writes metadata only to storage.local', async () => {
    const store = new MemoryBlobStore();
    const blob = new Blob(['webp-bytes'], { type: 'image/webp' });
    const created = await addAnnotationWithScreenshot(firstPage, firstInput, blob, { width: 800, height: 400 }, store);

    expect(created.screenshot).toEqual({
      mimeType: 'image/webp',
      width: 800,
      height: 400,
      byteLength: blob.size,
    });
    await expect(store.get(`screenshot:${created.id}`)).resolves.toBe(blob);
    const stored = await fakeBrowser.storage.local.get(pageKey(firstPage));
    expect(stored[pageKey(firstPage)]).toEqual([created]);
    expect(JSON.stringify(stored)).not.toContain('webp-bytes');
    expect(JSON.stringify(stored)).not.toContain('data:');
  });

  it('returns an empty list for an unseen page', async () => {
    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
  });

  it('keeps pages isolated while ignoring URL fragments in the key', async () => {
    const first = await addAnnotation(firstPage, firstInput);
    const second = await addAnnotation(secondPage, { ...firstInput, note: 'A different page' });

    await expect(listAnnotations('https://example.com/docs?mode=full#another-section')).resolves.toEqual([first]);
    await expect(listAnnotations(secondPage)).resolves.toEqual([second]);
  });

  it('updates by id, changes the field, and strictly bumps updatedAt', async () => {
    const created = await addAnnotation(firstPage, firstInput);
    const updated = await updateAnnotation(firstPage, created.id, { note: 'Updated note' });

    expect(updated).toMatchObject({ ...created, note: 'Updated note', updatedAt: expect.any(String) });
    expect(updated?.screenshot).toBeUndefined();
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    await expect(listAnnotations(firstPage)).resolves.toEqual([updated]);
  });

  it('preserves screenshot metadata through ordinary updates', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotationWithScreenshot(
      firstPage,
      firstInput,
      new Blob(['shot'], { type: 'image/png' }),
      { width: 10, height: 20 },
      store,
    );
    const updated = await updateAnnotation(firstPage, created.id, { note: 'Updated' });
    expect(updated?.screenshot).toEqual(created.screenshot);
  });

  it('persists css edits on update while leaving other fields intact', async () => {
    const created = await addAnnotation(firstPage, firstInput);
    const cssEdits = [
      { property: 'color', value: 'red', original: 'rgb(0, 0, 0)' },
      { property: 'margin', value: '1rem', original: '0px' },
    ];

    const updated = await updateAnnotation(firstPage, created.id, { cssEdits });

    expect(updated).toStrictEqual({
      ...created,
      screenshot: undefined,
      repro: undefined,
      cssEdits,
      updatedAt: expect.any(String),
    });
    expect(updated?.note).toBe(created.note);
    expect(updated?.selector).toBe(created.selector);
    expect(updated?.elementContext).toEqual(created.elementContext);
    await expect(listAnnotations(firstPage)).resolves.toEqual([updated]);
  });

  it('persists a repro on update while leaving other fields intact', async () => {
    const created = await addAnnotation(firstPage, firstInput);
    const repro = { steps: ['Open the page', 'Click the button'], expected: 'Dialog opens', actual: 'Nothing happens' };

    const updated = await updateAnnotation(firstPage, created.id, { repro });

    expect(updated).toMatchObject({
      id: created.id,
      pageUrl: created.pageUrl,
      note: created.note,
      selector: created.selector,
      elementContext: created.elementContext,
      repro,
      createdAt: created.createdAt,
      updatedAt: expect.any(String),
    });
    expect(updated?.note).toBe(created.note);
    expect(updated?.selector).toBe(created.selector);
    expect(updated?.elementContext).toEqual(created.elementContext);
    await expect(listAnnotations(firstPage)).resolves.toEqual([updated]);
  });

  it('treats an update for a missing id as a null no-op', async () => {
    await expect(updateAnnotation(firstPage, 'missing-id', { note: 'Should not be stored' })).resolves.toBeNull();
    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
  });

  it('deletes only the requested annotation', async () => {
    const store = new MemoryBlobStore();
    const first = await addAnnotationWithScreenshot(firstPage, firstInput, new Blob(['one'], { type: 'image/png' }), { width: 1, height: 1 }, store);
    const second = await addAnnotationWithScreenshot(firstPage, { ...firstInput, note: 'Keep this one' }, new Blob(['two'], { type: 'image/png' }), { width: 1, height: 1 }, store);

    await expect(deleteAnnotation(firstPage, first.id, store)).resolves.toBe(true);
    await expect(listAnnotations(firstPage)).resolves.toEqual([second]);
    await expect(store.get(`screenshot:${first.id}`)).resolves.toBeUndefined();
    await expect(store.get(`screenshot:${second.id}`)).resolves.toBeDefined();
    await expect(deleteAnnotation(firstPage, first.id, store)).resolves.toBe(false);
  });

  it('clears one page without affecting another page', async () => {
    const store = new MemoryBlobStore();
    const first = await addAnnotationWithScreenshot(firstPage, firstInput, new Blob(['one'], { type: 'image/png' }), { width: 1, height: 1 }, store);
    const other = await addAnnotationWithScreenshot(secondPage, firstInput, new Blob(['two'], { type: 'image/png' }), { width: 1, height: 1 }, store);

    await clearAnnotations(firstPage, store);

    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
    await expect(listAnnotations(secondPage)).resolves.toEqual([other]);
    await expect(store.get(`screenshot:${first.id}`)).resolves.toBeUndefined();
    await expect(store.get(`screenshot:${other.id}`)).resolves.toBeDefined();
  });

  it('surfaces a blob deletion failure after metadata deletion', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotationWithScreenshot(firstPage, firstInput, new Blob(['one'], { type: 'image/png' }), { width: 1, height: 1 }, store);
    store.failDelete = true;

    await expect(deleteAnnotation(firstPage, created.id, store)).rejects.toThrow('screenshot delete failed');
    await expect(listAnnotations(firstPage)).resolves.toEqual([]);
  });

  it('stores and removes attachment metadata and bytes', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotation(firstPage, firstInput);
    const metadata = { id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 };
    await addAttachment(firstPage, created.id, metadata, new Blob(['data'], { type: 'image/png' }), store);
    expect((await listAnnotations(firstPage))[0]?.attachments).toEqual([metadata]);
    expect(await store.get(attachmentKey(metadata.id))).toBeDefined();
    await deleteAttachment(firstPage, created.id, metadata.id, store);
    expect((await listAnnotations(firstPage))[0]?.attachments).toBeUndefined();
    expect(await store.get(attachmentKey(metadata.id))).toBeUndefined();
  });

  it('rejects an attachment once MAX_ATTACHMENTS is reached', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotation(firstPage, firstInput);
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      id: `attachment-${index}`,
      name: `photo-${index}.png`,
      mimeType: 'image/png' as const,
      byteLength: 4,
    }));
    await fakeBrowser.storage.local.set({ [pageKey(firstPage)]: [{ ...created, attachments }] });

    await expect(addAttachment(
      firstPage,
      created.id,
      { id: 'attachment-6', name: 'sixth.png', mimeType: 'image/png', byteLength: 4 },
      new Blob(['data'], { type: 'image/png' }),
      store,
    )).rejects.toThrow('at most 5 attachments');
  });

  it('deletes screenshot and attachment blobs with an annotation', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotation(firstPage, firstInput);
    const metadata = { id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 };
    await addAttachment(firstPage, created.id, metadata, new Blob(['data'], { type: 'image/png' }), store);
    await store.put(screenshotKey(created.id), new Blob(['shot'], { type: 'image/png' }));
    await deleteAnnotation(firstPage, created.id, store);
    expect(await store.get(screenshotKey(created.id))).toBeUndefined();
    expect(await store.get(attachmentKey(metadata.id))).toBeUndefined();
  });

  it('preserves attachments through ordinary updates', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotation(firstPage, firstInput);
    const metadata = { id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 };
    await addAttachment(firstPage, created.id, metadata, new Blob(['data'], { type: 'image/png' }), store);
    const updated = await updateAnnotation(firstPage, created.id, { status: 'resolved', note: 'Updated' });
    expect(updated?.status).toBe('resolved');
    expect(updated?.attachments).toEqual([metadata]);
  });

  it('clears all annotation screenshot and attachment blobs', async () => {
    const store = new MemoryBlobStore();
    const created = await addAnnotation(firstPage, firstInput);
    const metadata = { id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 };
    await addAttachment(firstPage, created.id, metadata, new Blob(['data'], { type: 'image/png' }), store);
    await store.put(screenshotKey(created.id), new Blob(['shot'], { type: 'image/png' }));
    await clearAnnotations(firstPage, store);
    expect(await store.get(screenshotKey(created.id))).toBeUndefined();
    expect(await store.get(attachmentKey(metadata.id))).toBeUndefined();
  });

  it('serializes concurrent additions for one page without losing data', async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) => addAnnotation(firstPage, { ...firstInput, note: `Concurrent note ${index}` })),
    );
    const stored = await listAnnotations(firstPage);
    expect(stored).toHaveLength(created.length);
    expect(new Set(stored.map((annotation) => annotation.id)).size).toBe(created.length);
    expect(stored).toEqual(expect.arrayContaining(created));
  });

  it('restores an annotation with its given identity and blobs, and skips an id already on the page', async () => {
    const store = new MemoryBlobStore();
    const screenshot = new Blob(['shot'], { type: 'image/png' });
    const attachment = new Blob(['file'], { type: 'image/png' });
    const restored: Annotation = {
      id: 'restored-1',
      pageUrl: firstPage,
      ...firstInput,
      status: 'resolved',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      screenshot: { mimeType: 'image/png', width: 3, height: 4, byteLength: screenshot.size },
      attachments: [{ id: 'restored-attachment', name: 'a.png', mimeType: 'image/png', byteLength: attachment.size }],
    };
    const blobs: [string, Blob][] = [[screenshotKey('restored-1'), screenshot], [attachmentKey('restored-attachment'), attachment]];

    await expect(restoreAnnotation(restored, blobs, store)).resolves.toBe(true);
    expect(await listAnnotations(firstPage)).toEqual([restored]);
    expect(store.blobs.get(screenshotKey('restored-1'))).toBe(screenshot);
    expect(store.blobs.get(attachmentKey('restored-attachment'))).toBe(attachment);

    const replacement = new Blob(['other'], { type: 'image/png' });
    await expect(restoreAnnotation({ ...restored, note: 'changed' }, [[screenshotKey('restored-1'), replacement]], store)).resolves.toBe(false);
    expect(await listAnnotations(firstPage)).toEqual([restored]);
    expect(store.blobs.get(screenshotKey('restored-1'))).toBe(screenshot);
  });

  it('removes the blobs it wrote when the restore metadata write fails', async () => {
    const store = new MemoryBlobStore();
    const restored: Annotation = {
      id: 'restored-2',
      pageUrl: firstPage,
      ...firstInput,
      status: 'open',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      screenshot: { mimeType: 'image/png', width: 1, height: 1, byteLength: 4 },
    };
    const set = vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota exceeded'));
    try {
      await expect(restoreAnnotation(restored, [[screenshotKey('restored-2'), new Blob(['shot'], { type: 'image/png' })]], store)).rejects.toThrow('quota exceeded');
    } finally {
      set.mockRestore();
    }
    expect(store.blobs.size).toBe(0);
    expect(await listAnnotations(firstPage)).toEqual([]);
  });
});
