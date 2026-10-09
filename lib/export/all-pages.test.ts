import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationClipboard, AnnotationExportDelivery } from './delivery';
import { exportAllPages } from './all-pages';
import { formatAllPages } from './format';

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  const pageUrl = overrides.pageUrl ?? 'https://example.com/article';
  return {
    id: 'annotation-1',
    pageUrl,
    note: 'Inspect this button',
    selector: '#submit-button',
    elementContext: {
      selector: '#submit-button',
      tagName: 'BUTTON',
      id: 'submit-button',
      classList: [],
      text: '',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      url: pageUrl,
      viewport: { width: 1280, height: 720 },
      sourcePath: null,
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

function recordingDelivery() {
  const events: string[] = [];
  const copied: AnnotationClipboard[] = [];
  const delivery: AnnotationExportDelivery = {
    async copy(pending) {
      // copy is invoked synchronously, before collect resolves; only the payload is awaited.
      events.push('copy');
      copied.push(await pending);
    },
    download(_markdown, filename) {
      events.push(`download:${filename}`);
    },
    downloadAsset(blob, filename) {
      events.push(`asset:${filename}:${blob.size}`);
    },
  };
  return { delivery, events, copied };
}

const withAssets = [
  annotation({
    id: 'one',
    screenshot: { mimeType: 'image/webp', width: 1, height: 1, byteLength: 3 },
    attachments: [
      { id: 'att-a', name: 'a.png', mimeType: 'image/png', byteLength: 1 },
      { id: 'att-b', name: 'b.jpeg', mimeType: 'image/jpeg', byteLength: 1 },
    ],
  }),
  annotation({ id: 'two', pageUrl: 'https://other.test/', createdAt: '2024-01-02T00:00:00.000Z' }),
];

describe('exportAllPages', () => {
  it('reports zero annotations, downloads nothing and reports no copy status', async () => {
    const { delivery, events, copied } = recordingDelivery();
    const readBlob = vi.fn();

    const status = await exportAllPages({ collect: async () => [], readBlob, delivery });

    expect(status).toBe('No annotations to export.');
    // The write starts before collect resolves, so copy is invoked; its rejected payload leaves the clipboard unchanged.
    expect(events).toEqual(['copy']);
    expect(copied).toEqual([]);
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('starts the copy before collect resolves, so the native write runs in the click', async () => {
    const { delivery, events } = recordingDelivery();
    let resolveCollect!: (annotations: Annotation[]) => void;
    const collected = new Promise<Annotation[]>((resolve) => {
      resolveCollect = resolve;
    });
    const blobs: Record<string, Blob> = {
      'screenshot:one': new Blob(['abc'], { type: 'image/webp' }),
      'attachment:att-a': new Blob(['a'], { type: 'image/png' }),
      'attachment:att-b': new Blob(['bb'], { type: 'image/jpeg' }),
    };

    const run = exportAllPages({ collect: () => collected, readBlob: async (key) => blobs[key], delivery });
    expect(events).toEqual(['copy']);
    resolveCollect(withAssets);

    expect(await run).toBe('Exported 2 annotations and 3 assets.');
  });

  it('reports a collect that throws synchronously as an export failure, with no copy and no download', async () => {
    const { delivery, events } = recordingDelivery();

    const status = await exportAllPages({
      collect: () => { throw new Error('storage unavailable'); },
      readBlob: vi.fn(),
      delivery,
    });

    expect(status).toBe('Export failed: storage unavailable');
    expect(events).toEqual([]);
  });

  it('leaves no payload rejection unhandled when copy does not consume the payload', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const delivery: AnnotationExportDelivery = { copy: async () => {}, download: vi.fn(), downloadAsset: vi.fn() };

      const status = await exportAllPages({ collect: async () => [], readBlob: vi.fn(), delivery });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(status).toBe('No annotations to export.');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('copies and downloads the all-pages Markdown, then every asset under the per-page filenames', async () => {
    const { delivery, events, copied } = recordingDelivery();
    const blobs: Record<string, Blob> = {
      'screenshot:one': new Blob(['abc'], { type: 'image/webp' }),
      'attachment:att-a': new Blob(['a'], { type: 'image/png' }),
      'attachment:att-b': new Blob(['bb'], { type: 'image/jpeg' }),
    };

    const status = await exportAllPages({ collect: async () => withAssets, readBlob: async (key) => blobs[key], delivery });

    expect(copied).toEqual([{ text: formatAllPages(withAssets), html: expect.any(String) }]);
    expect(copied[0]?.html).toContain('src="data:image/webp;base64,');
    expect(copied[0]?.html).toContain('src="data:image/png;base64,');
    expect(copied[0]?.html).toContain('src="data:image/jpeg;base64,');
    expect(events).toEqual([
      'copy',
      'download:annotations-all.md',
      'asset:annotations-one.webp:3',
      'asset:annotations-one-attachment-1.png:1',
      'asset:annotations-one-attachment-2.jpeg:2',
    ]);
    expect(status).toBe('Exported 2 annotations and 3 assets.');
  });

  it('skips missing blobs, still downloads them, and reports the missing image as the copy failure', async () => {
    const { delivery, events } = recordingDelivery();
    const blobs: Record<string, Blob> = { 'attachment:att-b': new Blob(['bb'], { type: 'image/jpeg' }) };

    const status = await exportAllPages({ collect: async () => withAssets, readBlob: async (key) => blobs[key], delivery });

    expect(events).toEqual(['copy', 'download:annotations-all.md', 'asset:annotations-one-attachment-2.jpeg:2']);
    expect(status).toBe(
      'Exported 2 annotations and 1 asset; skipped 2 missing assets. '
        + 'Downloaded; copy to clipboard failed: The image "Annotation screenshot" is missing and cannot be copied.',
    );
  });

  it('stops at the first blob read error and reports it', async () => {
    const { delivery, events } = recordingDelivery();
    const readBlob = vi.fn(async (key: string) => {
      if (key === 'attachment:att-a') throw new Error('Blob transaction failed');
      return new Blob(['x'], { type: 'image/webp' });
    });

    const status = await exportAllPages({ collect: async () => withAssets, readBlob, delivery });

    expect(status).toBe('Export failed: Blob transaction failed');
    expect(events).toEqual(['copy', 'download:annotations-all.md', 'asset:annotations-one.webp:1']);
    expect(readBlob).not.toHaveBeenCalledWith('attachment:att-b');
  });

  it('downloads the Markdown and every asset when the clipboard write fails, and reports the copy failure', async () => {
    const { delivery, events } = recordingDelivery();
    delivery.copy = async () => { throw new Error('Document is not focused.'); };
    const blobs: Record<string, Blob> = {
      'screenshot:one': new Blob(['abc'], { type: 'image/webp' }),
      'attachment:att-a': new Blob(['a'], { type: 'image/png' }),
      'attachment:att-b': new Blob(['bb'], { type: 'image/jpeg' }),
    };

    const status = await exportAllPages({ collect: async () => withAssets, readBlob: async (key) => blobs[key], delivery });

    expect(events).toEqual([
      'download:annotations-all.md',
      'asset:annotations-one.webp:3',
      'asset:annotations-one-attachment-1.png:1',
      'asset:annotations-one-attachment-2.jpeg:2',
    ]);
    expect(status).toBe('Exported 2 annotations and 3 assets. Downloaded; copy to clipboard failed: Document is not focused.');
  });
});
