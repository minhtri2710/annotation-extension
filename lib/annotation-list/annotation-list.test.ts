// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { format } from '../export/format';
import { createAnnotationList } from './annotation-list';
import type { AnnotationListPersistence } from './annotation-list';
import type { AnnotationExportDelivery } from '../export/delivery';

const pageUrl = 'https://example.com/article';

function annotation(id: string, note: string, screenshot?: string): Annotation {
  return {
    id,
    pageUrl,
    note,
    selector: `#target-${id}`,
    elementContext: { tagName: 'BUTTON' },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...(screenshot ? { screenshot } : {}),
  };
}

function persistence(annotations: Annotation[]): AnnotationListPersistence {
  return {
    listAnnotations: vi.fn().mockResolvedValue(annotations),
    sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
  };
}

describe('annotation list', () => {
  it('renders one row per annotation with note text and delete controls', async () => {
    const panel = document.createElement('div');
    const first = annotation('annotation-1', 'First note');
    const second = annotation('annotation-2', 'Second note');
    const store = persistence([first, second]);
    const list = createAnnotationList(panel, pageUrl, store);

    await list.render();

    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(2);
    expect(panel.textContent).toContain('First note');
    expect(panel.textContent).toContain('Second note');
    expect(panel.querySelectorAll('[data-annotation-delete]')).toHaveLength(2);
  });

  it('renders an empty state and no export controls when there are no annotations', async () => {
    const panel = document.createElement('div');
    const store = persistence([]);
    const list = createAnnotationList(panel, pageUrl, store);

    await list.render();

    expect(panel.querySelector('[data-annotation-empty-state]')).not.toBeNull();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(0);
    expect(panel.querySelector('[data-annotation-export]')).toBeNull();
  });

  it('copies one format and downloads its Markdown plus screenshot assets', async () => {
    const panel = document.createElement('div');
    const screenshot = 'data:image/png;base64,abc123';
    const secondScreenshot = 'data:image/png;base64,def456';
    const annotations = [
      annotation('annotation-1', 'Export me', screenshot),
      annotation('annotation-2', 'And me', secondScreenshot),
    ];
    const store = persistence(annotations);
    const delivery: AnnotationExportDelivery = {
      copy: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(),
      downloadAsset: vi.fn(),
    };
    const list = createAnnotationList(panel, pageUrl, store, delivery);

    await list.render();
    expect(panel.querySelector('[data-annotation-export-template]')).toBeNull();

    (panel.querySelector('[data-annotation-export-copy]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(delivery.copy).toHaveBeenCalledTimes(1));

    const markdown = format(annotations, pageUrl);
    expect(delivery.copy).toHaveBeenCalledWith(markdown);
    expect(markdown).not.toContain(screenshot);
    expect(markdown).not.toContain(secondScreenshot);

    (panel.querySelector('[data-annotation-export-download]') as HTMLButtonElement).click();
    expect(delivery.download).toHaveBeenCalledWith(markdown, expect.stringMatching(/\.md$/));
    expect(delivery.downloadAsset).toHaveBeenCalledTimes(2);
    expect(delivery.downloadAsset).toHaveBeenNthCalledWith(1, screenshot, 'annotations-annotation-1.png');
    expect(delivery.downloadAsset).toHaveBeenNthCalledWith(2, secondScreenshot, 'annotations-annotation-2.png');
  });

  it('deletes a row through the write owner and re-reads the list', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Delete me')]);
    const list = createAnnotationList(panel, pageUrl, store);

    await list.render();
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(store.sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.delete',
      pageUrl,
      id: 'annotation-1',
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
      type: 'annotation.clear',
      pageUrl,
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(2));
  });
});
