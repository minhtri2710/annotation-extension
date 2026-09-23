import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachmentKey, createBlobStore, isBlobKey, screenshotKey } from './blob-store';

const DATABASE_NAME = 'annotation-extension-blobs';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blob database delete blocked by an open connection'));
  });
}

async function bytesOf(blob: Blob | undefined): Promise<number[]> {
  expect(blob).toBeInstanceOf(Blob);
  return Array.from(new Uint8Array(await (blob as Blob).arrayBuffer()));
}

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

describe('createBlobStore (IndexedDB)', () => {
  it('round trips blob bytes and type through put and get', async () => {
    const store = createBlobStore();
    const bytes = [0, 1, 2, 127, 128, 254, 255];
    await store.put('screenshot:a', new Blob([new Uint8Array(bytes)], { type: 'image/webp' }));
    await store.put('attachment:b', new Blob(['hello'], { type: 'image/png' }));

    const screenshot = await store.get('screenshot:a');
    expect(screenshot?.type).toBe('image/webp');
    expect(await bytesOf(screenshot)).toEqual(bytes);
    const attachment = await store.get('attachment:b');
    expect(attachment?.type).toBe('image/png');
    expect(await attachment?.text()).toBe('hello');
  });

  it('put replaces the blob stored under the same key', async () => {
    const store = createBlobStore();
    await store.put('screenshot:a', new Blob(['old'], { type: 'image/png' }));
    await store.put('screenshot:a', new Blob(['new'], { type: 'image/webp' }));

    const blob = await store.get('screenshot:a');
    expect(blob?.type).toBe('image/webp');
    expect(await blob?.text()).toBe('new');
  });

  it('get resolves undefined for a missing key', async () => {
    const store = createBlobStore();
    await expect(store.get('screenshot:missing')).resolves.toBeUndefined();
    await store.put('screenshot:present', new Blob(['x']));
    await expect(store.get('screenshot:missing')).resolves.toBeUndefined();
  });

  it('delete removes exactly the listed keys and ignores missing ones', async () => {
    const store = createBlobStore();
    await store.put('screenshot:a', new Blob(['a']));
    await store.put('attachment:b', new Blob(['b']));
    await store.put('attachment:c', new Blob(['c']));

    await store.delete(['screenshot:a', 'attachment:c', 'attachment:missing']);

    await expect(store.get('screenshot:a')).resolves.toBeUndefined();
    await expect(store.get('attachment:c')).resolves.toBeUndefined();
    expect(await (await store.get('attachment:b'))?.text()).toBe('b');
  });

  it('delete with no keys leaves every blob in place', async () => {
    const store = createBlobStore();
    await store.put('screenshot:a', new Blob(['a']));
    await store.delete([]);
    expect(await (await store.get('screenshot:a'))?.text()).toBe('a');
  });

  it('a second store instance sees the first one\'s writes and deletes', async () => {
    const writer = createBlobStore();
    const reader = createBlobStore();
    await writer.put('attachment:shared', new Blob(['shared'], { type: 'image/gif' }));

    const blob = await reader.get('attachment:shared');
    expect(blob?.type).toBe('image/gif');
    expect(await blob?.text()).toBe('shared');

    await reader.delete(['attachment:shared']);
    await expect(writer.get('attachment:shared')).resolves.toBeUndefined();
  });

  it('closes its connection after each operation so the database can be deleted', async () => {
    const store = createBlobStore();
    await store.put('screenshot:a', new Blob(['a']));
    await store.get('screenshot:a');
    await store.delete(['screenshot:a']);
    await expect(deleteDatabase()).resolves.toBeUndefined();
  });
});

describe('blob keys', () => {
  it('builds screenshot and attachment keys from the id', () => {
    expect(screenshotKey('annotation-1')).toBe('screenshot:annotation-1');
    expect(attachmentKey('attachment-1')).toBe('attachment:attachment-1');
  });

  it('isBlobKey accepts only the two key forms with a non-empty, colon-free id', () => {
    expect(isBlobKey(screenshotKey('a1'))).toBe(true);
    expect(isBlobKey(attachmentKey('b2'))).toBe(true);
    for (const value of [
      'screenshot:',
      'attachment:',
      'screenshot:a:b',
      'other:a',
      'xscreenshot:a',
      'screenshot',
      '',
      1,
      null,
      undefined,
      ['screenshot:a'],
    ]) {
      expect(isBlobKey(value)).toBe(false);
    }
  });
});
