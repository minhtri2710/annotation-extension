import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardFailure, productionExportDelivery, type AnnotationClipboard } from './delivery';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clipboardFailure', () => {
  it('stringifies a non-Error rejection', async () => {
    await expect(clipboardFailure(() => Promise.reject('denied'))).resolves.toBe(
      'Downloaded; copy to clipboard failed: denied',
    );
  });
});

describe('productionExportDelivery', () => {
  const html = '<h2>Notes</h2><img src="data:image/png;base64,AAAA">';
  const missingImage = 'The image "Annotation screenshot" is missing and cannot be copied.';

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function stubClipboardItem() {
    const items: { data: Record<string, Promise<Blob>> }[] = [];
    class RecordingClipboardItem {
      readonly data: Record<string, Promise<Blob>>;

      constructor(data: Record<string, Promise<Blob>>) {
        this.data = data;
        items.push({ data });
      }
    }
    vi.stubGlobal('ClipboardItem', RecordingClipboardItem);
    return items;
  }

  it('copy starts the write before the payload settles, then writes the HTML and the Markdown text as one ClipboardItem', async () => {
    const items = stubClipboardItem();
    const payload = deferred<AnnotationClipboard>();
    const write = vi.fn(async (_items: unknown[]) => {});
    vi.stubGlobal('navigator', { clipboard: { write } });

    const copied = productionExportDelivery.copy(payload.promise);
    expect(write).toHaveBeenCalledTimes(1);
    payload.resolve({ text: '# Notes', html });
    await copied;

    expect(write.mock.calls[0]?.[0]).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!.data).sort()).toEqual(['text/html', 'text/plain']);
    const htmlBlob = await items[0]!.data['text/html']!;
    expect(htmlBlob.type).toBe('text/html');
    expect(await htmlBlob.text()).toBe(html);
    const textBlob = await items[0]!.data['text/plain']!;
    expect(textBlob.type).toBe('text/plain');
    expect(await textBlob.text()).toBe('# Notes');
  });

  it('copy reports the payload error, not the generic DataError the browser raises for a rejected entry', async () => {
    stubClipboardItem();
    vi.stubGlobal('navigator', {
      clipboard: {
        write: async (items: { data: Record<string, Promise<Blob>> }[]) => {
          await Promise.allSettled(Object.values(items[0]!.data));
          throw new DOMException('Data provided to an operation does not meet requirements', 'DataError');
        },
      },
    });

    await expect(productionExportDelivery.copy(Promise.reject(new Error(missingImage)))).rejects.toThrow(missingImage);
  });

  it('copy reports the write error when the payload succeeds and the write is denied', async () => {
    stubClipboardItem();
    vi.stubGlobal('navigator', {
      clipboard: { write: async () => { throw new DOMException('Write permission denied.', 'NotAllowedError'); } },
    });

    await expect(
      productionExportDelivery.copy(Promise.resolve({ text: '# Notes', html })),
    ).rejects.toThrow('Write permission denied.');
  });

  it('copy reports the payload error when a denied write never reads its entries', async () => {
    stubClipboardItem();
    vi.stubGlobal('navigator', {
      clipboard: { write: async () => { throw new DOMException('Write permission denied.', 'NotAllowedError'); } },
    });

    await expect(productionExportDelivery.copy(Promise.reject(new Error(missingImage)))).rejects.toThrow(missingImage);
  });

  it('copy takes the legacy path without calling write when ClipboardItem is absent', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('document', { getSelection: () => null });
    const write = vi.fn(async (_items: unknown[]) => {});
    vi.stubGlobal('navigator', { clipboard: { write } });

    await expect(productionExportDelivery.copy(Promise.resolve({ text: '# Notes', html }))).rejects.toThrow(
      'does not support the legacy copy command',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('copy on the legacy path reports the payload error before any selection is made', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const getSelection = vi.fn(() => null);
    vi.stubGlobal('document', { getSelection });
    vi.stubGlobal('navigator', { clipboard: {} });

    await expect(productionExportDelivery.copy(Promise.reject(new Error(missingImage)))).rejects.toThrow(missingImage);
    expect(getSelection).not.toHaveBeenCalled();
  });

  function stubDownload() {
    const events: string[] = [];
    const link = { href: '', download: '', click: vi.fn(() => events.push('click')) };
    const createElement = vi.fn((_tag: string) => link);
    vi.stubGlobal('document', { createElement });
    const blobs: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:test/1';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      events.push(`revoke ${url}`);
    });
    return { events, link, createElement, blobs, createObjectURL, revokeObjectURL };
  }

  it('download clicks an anchor for a text/markdown blob and revokes its URL afterwards', async () => {
    const stub = stubDownload();

    productionExportDelivery.download('# Notes\n', 'notes.md');

    expect(stub.createElement.mock.calls).toEqual([['a']]);
    expect(stub.blobs).toHaveLength(1);
    expect(stub.blobs[0]?.type).toBe('text/markdown');
    expect(await stub.blobs[0]?.text()).toBe('# Notes\n');
    expect(stub.link.href).toBe('blob:test/1');
    expect(stub.link.download).toBe('notes.md');
    expect(stub.events).toEqual(['click', 'revoke blob:test/1']);
  });

  it('downloadAsset downloads the given blob unchanged under the given filename', () => {
    const stub = stubDownload();
    const asset = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

    productionExportDelivery.downloadAsset(asset, 'shot.webp');

    expect(stub.blobs).toHaveLength(1);
    expect(stub.blobs[0]).toBe(asset);
    expect(stub.link.href).toBe('blob:test/1');
    expect(stub.link.download).toBe('shot.webp');
    expect(stub.events).toEqual(['click', 'revoke blob:test/1']);
  });
});
