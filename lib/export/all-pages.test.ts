import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationExportDelivery } from './delivery';
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
  const copied: string[] = [];
  const delivery: AnnotationExportDelivery = {
    async copy(markdown) {
      copied.push(markdown);
      events.push('copy');
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
  it('reports zero annotations and delivers nothing', async () => {
    const { delivery, events } = recordingDelivery();
    const readBlob = vi.fn();

    const status = await exportAllPages({ collect: async () => [], readBlob, delivery });

    expect(status).toBe('No annotations to export.');
    expect(events).toEqual([]);
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('copies and downloads the all-pages Markdown, then every asset under the per-page filenames', async () => {
    const { delivery, events, copied } = recordingDelivery();
    const blobs: Record<string, Blob> = {
      'screenshot:one': new Blob(['abc']),
      'attachment:att-a': new Blob(['a']),
      'attachment:att-b': new Blob(['bb']),
    };

    const status = await exportAllPages({ collect: async () => withAssets, readBlob: async (key) => blobs[key], delivery });

    expect(copied).toEqual([formatAllPages(withAssets)]);
    expect(events).toEqual([
      'copy',
      'download:annotations-all.md',
      'asset:annotations-one.webp:3',
      'asset:annotations-one-attachment-1.png:1',
      'asset:annotations-one-attachment-2.jpeg:2',
    ]);
    expect(status).toBe('Exported 2 annotations and 3 assets.');
  });

  it('skips missing blobs and counts the skips in the status', async () => {
    const { delivery, events } = recordingDelivery();
    const blobs: Record<string, Blob> = { 'attachment:att-b': new Blob(['bb']) };

    const status = await exportAllPages({ collect: async () => withAssets, readBlob: async (key) => blobs[key], delivery });

    expect(events).toEqual(['copy', 'download:annotations-all.md', 'asset:annotations-one-attachment-2.jpeg:2']);
    expect(status).toBe('Exported 2 annotations and 1 asset; skipped 2 missing assets.');
  });

  it('stops at the first blob read error and reports it', async () => {
    const { delivery, events } = recordingDelivery();
    const readBlob = vi.fn(async (key: string) => {
      if (key === 'attachment:att-a') throw new Error('Blob transaction failed');
      return new Blob(['x']);
    });

    const status = await exportAllPages({ collect: async () => withAssets, readBlob, delivery });

    expect(status).toBe('Export failed: Blob transaction failed');
    expect(events).toEqual(['copy', 'download:annotations-all.md', 'asset:annotations-one.webp:1']);
    expect(readBlob).toHaveBeenCalledTimes(2);
  });
});
