import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardFailure, productionExportDelivery } from './delivery';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clipboardFailure', () => {
  it('returns undefined when the copy succeeds', async () => {
    const copy = vi.fn(async () => {});
    await expect(clipboardFailure(copy)).resolves.toBeUndefined();
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('returns the status suffix with the error message when the copy rejects', async () => {
    await expect(clipboardFailure(() => Promise.reject(new Error('Document is not focused')))).resolves.toBe(
      'Downloaded; copy to clipboard failed: Document is not focused',
    );
  });

  it('stringifies a non-Error rejection', async () => {
    await expect(clipboardFailure(() => Promise.reject('denied'))).resolves.toBe(
      'Downloaded; copy to clipboard failed: denied',
    );
  });
});

describe('productionExportDelivery', () => {
  it('copy writes the markdown to navigator.clipboard', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await productionExportDelivery.copy('# Notes');
    expect(writeText.mock.calls).toEqual([['# Notes']]);
  });

  it('copy propagates a clipboard rejection', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    await expect(productionExportDelivery.copy('# Notes')).rejects.toThrow('denied');
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
