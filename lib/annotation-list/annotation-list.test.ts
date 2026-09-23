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
    readOnboardingOpen: vi.fn().mockResolvedValue(true),
    writeOnboardingOpen: vi.fn().mockResolvedValue(undefined),
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

  it('renders a list error without rejecting and clears it when the list closes', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Loaded after failure')]);
    vi.mocked(store.listAnnotations)
      .mockRejectedValueOnce(new Error('list failed'))
      .mockResolvedValueOnce([annotation('annotation-1', 'Loaded after failure')]);
    const list = createAnnotationList(panel, pageUrl, store);

    await expect(list.render()).resolves.toBeUndefined();
    expect(panel.querySelector('h2')?.textContent).toBe('All annotations');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('list failed');
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(0);

    list.clear();
    expect(panel.childElementCount).toBe(0);
    await list.render();
    expect(panel.querySelector('[data-annotation-status=""]')).toBeNull();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(1);
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

  it('drops the post-action render when the list is cleared while the write is pending', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Old route note')]);
    let resolveWrite: (value: unknown) => void = () => undefined;
    vi.mocked(store.sendAnnotationWrite).mockReturnValue(new Promise((resolve) => { resolveWrite = resolve; }));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1);

    list.clear();
    resolveWrite(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.childElementCount).toBe(0);
    expect(store.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it('drops the post-action error render when the list re-renders while the write is pending', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Clear me')]);
    let rejectWrite: (error: unknown) => void = () => undefined;
    vi.mocked(store.sendAnnotationWrite).mockReturnValue(new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();

    await list.render();
    rejectWrite(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.textContent).not.toContain('stale failure');
    expect(store.listAnnotations).toHaveBeenCalledTimes(2);
  });

  it('renders a How it works section right after the heading with the five steps', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'Note')]));
    await list.render();
    const onboarding = panel.querySelector<HTMLDetailsElement>('details[data-annotation-onboarding]');
    expect(onboarding).not.toBeNull();
    expect(onboarding!.previousElementSibling?.tagName).toBe('H2');
    expect(panel.firstElementChild?.tagName).toBe('H2');
    expect(onboarding!.open).toBe(true);
    expect(onboarding!.querySelector('summary')?.textContent).toBe('How it works');
    expect(Array.from(onboarding!.querySelectorAll('ol > li'), (item) => item.textContent)).toEqual([
      'Click Annotate (default shortcut Ctrl+Shift+. ; Control+Shift+. on Mac), then click any element to leave a note.',
      'Pins mark annotated elements. Click a pin to reopen its note.',
      "View all lists this page's notes. Export them here, or export every page from the extension popup.",
      'Scan checks the page against design rules. Locate jumps to each finding.',
      'Press Esc to stop annotating.',
    ]);
  });

  it('opens How it works from the stored state and persists toggles', async () => {
    const panel = document.createElement('div');
    const store = persistence([]);
    vi.mocked(store.readOnboardingOpen).mockResolvedValue(false);
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    const onboarding = panel.querySelector<HTMLDetailsElement>('[data-annotation-onboarding]')!;
    expect(onboarding.open).toBe(false);
    expect(store.writeOnboardingOpen).not.toHaveBeenCalled();
    onboarding.open = true;
    onboarding.dispatchEvent(new Event('toggle'));
    expect(store.writeOnboardingOpen).toHaveBeenLastCalledWith(true);
    onboarding.open = false;
    onboarding.dispatchEvent(new Event('toggle'));
    expect(store.writeOnboardingOpen).toHaveBeenLastCalledWith(false);
  });

  it('renders How it works open and keeps the list when the onboarding read fails', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Still listed')]);
    vi.mocked(store.readOnboardingOpen).mockRejectedValue(new Error('storage down'));
    const list = createAnnotationList(panel, pageUrl, store);
    await expect(list.render()).resolves.toBeUndefined();
    expect(panel.querySelector<HTMLDetailsElement>('[data-annotation-onboarding]')?.open).toBe(true);
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(1);
    expect(panel.querySelector('[data-annotation-status=""]')).toBeNull();
  });
});
