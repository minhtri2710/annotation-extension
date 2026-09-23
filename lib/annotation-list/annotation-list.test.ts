// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { format } from '../export/format';
import { createAnnotationList } from './annotation-list';
import type { AnnotationListPersistence } from './annotation-list';
import type { AnnotationExportDelivery } from '../export/delivery';
import type { ElementContext } from '../capture/context';

const pageUrl = 'https://example.com/article';
const elementContext: ElementContext = {
  selector: '#target', tagName: 'BUTTON', id: 'target', classList: [], text: 'Target',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: pageUrl,
  viewport: { width: 1280, height: 720 }, sourcePath: null,
};

function annotation(id: string, note: string, mimeType?: string): Annotation {
  return {
    id, pageUrl, note, selector: `#target-${id}`, elementContext,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
    ...(mimeType ? { screenshot: { mimeType, width: 10, height: 10, byteLength: 3 } } : {}),
  };
}

function persistence(annotations: Annotation[]): AnnotationListPersistence {
  return {
    listAnnotations: vi.fn().mockResolvedValue(annotations),
    sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
    readBlob: vi.fn().mockResolvedValue(new Blob(['abc'], { type: 'image/webp' })),
  };
}

describe('annotation list', () => {
  it('renders one row per annotation with note text and delete controls', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'First note'), annotation('annotation-2', 'Second note')]);
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(2);
    expect(panel.textContent).toContain('First note');
    expect(panel.textContent).toContain('Second note');
    expect(panel.querySelectorAll('[data-annotation-delete]')).toHaveLength(2);
  });

  it('renders an empty state and no export controls when there are no annotations', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([]));
    await list.render();
    expect(panel.querySelector('[data-annotation-empty-state]')).not.toBeNull();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(0);
    expect(panel.querySelector('[data-annotation-export]')).toBeNull();
    expect(panel.querySelector('[data-annotation-export-template]')).toBeNull();
  });

  it('copies one format and downloads its Markdown plus screenshot assets', async () => {
    const panel = document.createElement('div');
    const annotations = [annotation('annotation-1', 'Export me', 'image/webp'), annotation('annotation-2', 'And me', 'image/jpeg')];
    const store = persistence(annotations);
    const delivery: AnnotationExportDelivery = { copy: vi.fn().mockResolvedValue(undefined), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, store, delivery);
    await list.render();

    (panel.querySelector('[data-annotation-export-copy]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(delivery.copy).toHaveBeenCalledTimes(1));
    const markdown = format(annotations, pageUrl);
    expect(delivery.copy).toHaveBeenCalledWith(markdown);
    expect(markdown).not.toContain('abc');
    (panel.querySelector('[data-annotation-export-download]') as HTMLButtonElement).click();
    expect(delivery.download).toHaveBeenCalledWith(markdown, expect.stringMatching(/\.md$/));
    await vi.waitFor(() => expect(delivery.downloadAsset).toHaveBeenCalledTimes(2));
    expect(delivery.downloadAsset).toHaveBeenNthCalledWith(1, expect.any(Blob), 'annotations-annotation-1.webp');
    expect(delivery.downloadAsset).toHaveBeenNthCalledWith(2, expect.any(Blob), 'annotations-annotation-2.jpeg');
    expect(store.readBlob).toHaveBeenCalledWith('screenshot:annotation-1');
  });

  it('downloads attachment assets even without a screenshot', async () => {
    const panel = document.createElement('div');
    const annotations = [annotation('annotation-1', 'Export attachment')];
    annotations[0]!.attachments = [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 3 }];
    const store = persistence(annotations);
    const delivery: AnnotationExportDelivery = { copy: vi.fn().mockResolvedValue(undefined), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, store, delivery);
    await list.render();
    (panel.querySelector('[data-annotation-export-download]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(delivery.downloadAsset).toHaveBeenCalledTimes(1));
    expect(delivery.downloadAsset).toHaveBeenCalledWith(expect.any(Blob), 'annotations-annotation-1-attachment-1.png');
    expect(store.readBlob).toHaveBeenCalledWith('attachment:attachment-1');
  });

  it('shows a write error and keeps the list after delete rejects', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Keep after failure')]);
    vi.mocked(store.sendAnnotationWrite).mockRejectedValue(new Error('delete failed'));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.textContent).toContain('delete failed'));
    expect(panel.querySelector('[data-annotation-row]')).not.toBeNull();
  });

  it('deletes a row through the write owner and re-reads the list', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Delete me')]);
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(store.sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.delete', pageUrl, id: 'annotation-1',
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('clears all annotations through the write owner and re-reads the list', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Clear me')]);
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(store.sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.clear', pageUrl,
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(2));
  });
});
