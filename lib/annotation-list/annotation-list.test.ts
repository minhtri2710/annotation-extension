// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { format } from '../export/format';
import { ANNOTATION_EDIT_EVENT, ANNOTATION_START_EVENT, createAnnotationList } from './annotation-list';
import { buildOverlayShell } from '../ui/shell';
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

  it('reports a successful Copy in the live region and the visible status', async () => {
    const panel = document.createElement('div');
    const delivery: AnnotationExportDelivery = { copy: vi.fn().mockResolvedValue(undefined), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'Copy me')]), delivery);
    await list.render();
    (panel.querySelector('[data-annotation-export-copy]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('Copied to clipboard.'));
    expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('Copied to clipboard.');
  });

  it('reports a failed Copy with its reason instead of swallowing it', async () => {
    const panel = document.createElement('div');
    const delivery: AnnotationExportDelivery = { copy: vi.fn().mockRejectedValue(new Error('Document is not focused.')), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'Copy me')]), delivery);
    await list.render();
    (panel.querySelector('[data-annotation-export-copy]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('Copy failed: Document is not focused.'));
    expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('Copy failed: Document is not focused.');
    expect(panel.querySelector('[data-annotation-row]')).not.toBeNull();
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
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
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
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();

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
    (panel.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement).click();

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
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1);

    list.clear();
    resolveWrite(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.childElementCount).toBe(0);
    expect(store.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it('keeps the post-action error render when the list re-renders while the write is pending', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Clear me')]);
    let rejectWrite: (error: unknown) => void = () => undefined;
    vi.mocked(store.sendAnnotationWrite).mockReturnValue(new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement).click();

    await list.render();
    rejectWrite(new Error('late failure'));
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('late failure'));
    expect(store.listAnnotations).toHaveBeenCalledTimes(3);
  });

  it('drops the post-action error render when the list is cleared while the write is pending', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Clear me')]);
    let rejectWrite: (error: unknown) => void = () => undefined;
    vi.mocked(store.sendAnnotationWrite).mockReturnValue(new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement).click();

    list.clear();
    rejectWrite(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.childElementCount).toBe(0);
    expect(store.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it('re-renders after each of two in-flight deletes resolving in order', async () => {
    const panel = document.createElement('div');
    let stored = [annotation('annotation-a', 'Row A'), annotation('annotation-b', 'Row B')];
    const store = persistence([]);
    vi.mocked(store.listAnnotations).mockImplementation(async () => stored);
    const resolvers = new Map<string, () => void>();
    vi.mocked(store.sendAnnotationWrite).mockImplementation((message) => new Promise((resolve) => {
      const id = message.type === 'annotation.delete' ? message.id : '';
      resolvers.set(id, () => {
        stored = stored.filter((entry) => entry.id !== id);
        resolve(undefined);
      });
    }));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    const deletes = panel.querySelectorAll<HTMLButtonElement>('[data-annotation-delete]');
    deletes[0]!.click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    deletes[1]!.click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(2);

    resolvers.get('annotation-a')!();
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(2));
    resolvers.get('annotation-b')!();
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-empty-state]')).not.toBeNull());
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(0);
  });

  it('clears an action error on a later success even if a render ran while it was pending', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Retry me')]);
    vi.mocked(store.sendAnnotationWrite).mockRejectedValueOnce(new Error('delete failed'));
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('delete failed'));

    let resolveWrite: (value: unknown) => void = () => undefined;
    vi.mocked(store.sendAnnotationWrite).mockReturnValueOnce(new Promise((resolve) => { resolveWrite = resolve; }));
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await list.render();
    expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('delete failed');
    resolveWrite(undefined);
    await vi.waitFor(() => expect(store.listAnnotations).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')).toBeNull());
  });

  it('surfaces an export-download error, even across a re-render, but not after clear', async () => {
    const panel = document.createElement('div');
    const store = persistence([annotation('annotation-1', 'Export me', 'image/webp')]);
    const delivery: AnnotationExportDelivery = { copy: vi.fn().mockResolvedValue(undefined), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, store, delivery);
    const download = () => (panel.querySelector('[data-annotation-export-download]') as HTMLButtonElement).click();
    let rejectRead: (error: unknown) => void = () => undefined;
    const pendingRead = () => vi.mocked(store.readBlob).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRead = reject; }));

    await list.render();
    vi.mocked(store.readBlob).mockRejectedValueOnce(new Error('read failed'));
    download();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('read failed'));

    pendingRead();
    download();
    await list.render();
    rejectRead(new Error('late read failed'));
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('late read failed'));

    pendingRead();
    download();
    const calls = vi.mocked(store.listAnnotations).mock.calls.length;
    list.clear();
    rejectRead(new Error('stale read failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.childElementCount).toBe(0);
    expect(store.listAnnotations).toHaveBeenCalledTimes(calls);
    expect(delivery.downloadAsset).not.toHaveBeenCalled();
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

describe('annotation list confirmation, row actions, focus and live status', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function mounted() {
    const container = document.createElement('div');
    document.body.append(container);
    return buildOverlayShell(container);
  }

  function anchor(id: string): HTMLElement {
    const target = document.createElement('p');
    target.id = `target-${id}`;
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    return target;
  }

  it('does not render Clear all when the list is empty', async () => {
    const panel = document.createElement('div');
    await createAnnotationList(panel, pageUrl, persistence([])).render();
    expect(panel.querySelector('[data-annotation-empty-state]')).not.toBeNull();
    expect(panel.querySelector('[data-annotation-clear]')).toBeNull();
  });

  it('asks inline before clearing, focuses Cancel, and only Delete all sends annotation.clear', async () => {
    const { panel } = mounted();
    const store = persistence([annotation('annotation-1', 'One'), annotation('annotation-2', 'Two')]);
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);
    await createAnnotationList(panel, pageUrl, store).render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(store.sendAnnotationWrite).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(panel.querySelector('[data-annotation-clear]')).toBeNull();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(2);
    const prompt = panel.querySelector('[data-annotation-clear-prompt]');
    expect(prompt?.querySelector('p')?.textContent).toBe('Delete all 2 annotations on this page? This cannot be undone.');
    const deleteAll = prompt?.querySelector<HTMLButtonElement>('[data-annotation-clear-confirm]');
    const cancel = prompt?.querySelector<HTMLButtonElement>('[data-annotation-clear-cancel]');
    expect([deleteAll?.textContent, deleteAll?.type, cancel?.textContent, cancel?.type]).toEqual(['Delete all', 'button', 'Cancel', 'button']);
    expect(document.activeElement).toBe(cancel);

    deleteAll?.click();
    await vi.waitFor(() => expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(store.sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.clear', pageUrl } satisfies AnnotationWriteMessage);
  });

  it('Cancel and Escape restore Clear all with focus, send nothing, and keep Escape inside the prompt', async () => {
    const { panel } = mounted();
    const store = persistence([annotation('annotation-1', 'One')]);
    const panelKeydown = vi.fn();
    panel.addEventListener('keydown', panelKeydown);
    await createAnnotationList(panel, pageUrl, store).render();

    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-clear-cancel]') as HTMLButtonElement).click();
    expect(panel.querySelector('[data-annotation-clear-prompt]')).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-clear]'));

    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    panel.querySelector('[data-annotation-clear-cancel]')!.dispatchEvent(escape);
    expect(panel.querySelector('[data-annotation-clear-prompt]')).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-clear]'));
    expect(panelKeydown).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(store.sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('asks inline before deleting a row, focuses Cancel, and only Delete sends annotation.delete', async () => {
    const { panel } = mounted();
    const store = persistence([annotation('annotation-1', 'One'), annotation('annotation-2', 'Two')]);
    await createAnnotationList(panel, pageUrl, store).render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-2"] [data-annotation-delete]')!.click();
    await Promise.resolve();

    expect(store.sendAnnotationWrite).not.toHaveBeenCalled();
    const prompt = panel.querySelector('[data-annotation-id="annotation-2"] [data-annotation-delete-prompt]');
    expect([prompt?.getAttribute('role'), prompt?.getAttribute('aria-label')]).toEqual(['group', 'Confirm delete annotation 2']);
    expect(prompt?.querySelector('p')?.textContent).toBe('Delete annotation 2? This cannot be undone.');
    const confirm = prompt?.querySelector<HTMLButtonElement>('[data-annotation-delete-confirm]');
    const cancel = prompt?.querySelector<HTMLButtonElement>('[data-annotation-delete-cancel]');
    expect([confirm?.textContent, cancel?.textContent]).toEqual(['Delete', 'Cancel']);
    expect(document.activeElement).toBe(cancel);

    confirm?.click();
    await vi.waitFor(() => expect(store.sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(store.sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.delete', pageUrl, id: 'annotation-2' } satisfies AnnotationWriteMessage);
  });

  it('Cancel and Escape keep the row, restore its Delete with focus, and keep Escape inside the prompt', async () => {
    const { panel } = mounted();
    const store = persistence([annotation('annotation-1', 'One')]);
    const panelKeydown = vi.fn();
    panel.addEventListener('keydown', panelKeydown);
    await createAnnotationList(panel, pageUrl, store).render();
    const remove = () => panel.querySelector<HTMLButtonElement>('[data-annotation-delete]');

    remove()!.click();
    panel.querySelector<HTMLButtonElement>('[data-annotation-delete-cancel]')!.click();
    expect(panel.querySelector('[data-annotation-delete-prompt]')).toBeNull();
    expect(document.activeElement).toBe(remove());

    remove()!.click();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    panel.querySelector('[data-annotation-delete-cancel]')!.dispatchEvent(escape);
    expect(panel.querySelector('[data-annotation-delete-prompt]')).toBeNull();
    expect(document.activeElement).toBe(remove());
    expect(panelKeydown).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(store.sendAnnotationWrite).not.toHaveBeenCalled();
    expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(1);
  });

  it('offers Start annotating under the empty state, which asks the host to start capture', async () => {
    const panel = document.createElement('div');
    const onStart = vi.fn();
    panel.addEventListener(ANNOTATION_START_EVENT, onStart);
    await createAnnotationList(panel, pageUrl, persistence([])).render();
    const start = panel.querySelector<HTMLButtonElement>('[data-annotation-start]');
    expect(panel.querySelector('[data-annotation-empty-state]')?.nextElementSibling).toBe(start);
    expect([start?.textContent, start?.type]).toEqual(['Start annotating', 'button']);

    start!.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('names the export buttons by the Markdown they produce', async () => {
    const panel = document.createElement('div');
    await createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One')])).render();
    expect([...panel.querySelectorAll('[data-annotation-export] button')].map((button) => button.textContent))
      .toEqual(['Copy Markdown', 'Download Markdown']);
  });

  it('counts every downloaded screenshot and attachment in the Download status', async () => {
    const panel = document.createElement('div');
    const annotations = [annotation('annotation-1', 'One', 'image/webp'), annotation('annotation-2', 'Two')];
    annotations[1]!.attachments = [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 3 }];
    const store = persistence(annotations);
    const delivery: AnnotationExportDelivery = { copy: vi.fn(), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, store, delivery);
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-export-download]')!.click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('Download started for annotations.md and 2 image files.'));
    expect(delivery.downloadAsset).toHaveBeenCalledTimes(2);

    vi.mocked(store.listAnnotations).mockResolvedValue([annotation('annotation-3', 'Text only')]);
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-export-download]')!.click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('Download started for annotations.md.'));
    expect(delivery.downloadAsset).toHaveBeenCalledTimes(2);
  });

  it('keeps focus inside the panel on the heading after Delete all re-renders', async () => {
    const { panel } = mounted();
    const store = persistence([]);
    vi.mocked(store.listAnnotations).mockResolvedValueOnce([annotation('annotation-1', 'One')]).mockResolvedValue([]);
    await createAnnotationList(panel, pageUrl, store).render();
    (panel.querySelector('[data-annotation-clear]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement).focus();
    (panel.querySelector('[data-annotation-clear-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-empty-state]')).not.toBeNull());
    expect(document.activeElement).toBe(panel.querySelector('h2'));
  });

  it('keeps focus on the same row control after a failed delete re-renders', async () => {
    const { panel } = mounted();
    const store = persistence([annotation('annotation-1', 'One'), annotation('annotation-2', 'Two')]);
    vi.mocked(store.sendAnnotationWrite).mockRejectedValue(new Error('delete failed'));
    await createAnnotationList(panel, pageUrl, store).render();
    const second = () => panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-2"] [data-annotation-delete]')!;
    const before = second();
    before.focus();
    before.click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('delete failed'));
    expect(document.activeElement).toBe(second());
    expect(document.activeElement).not.toBe(before);
  });

  it('announces list errors through one persistent role=status node and clears it on close', async () => {
    const { panel, root } = mounted();
    const store = persistence([annotation('annotation-1', 'One')]);
    vi.mocked(store.sendAnnotationWrite).mockRejectedValueOnce(new Error('delete failed'));
    const list = createAnnotationList(panel, pageUrl, store);
    root.append(list.live);
    expect(list.live.getAttribute('role')).toBe('status');
    await list.render();
    expect(list.live.textContent).toBe('');
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('delete failed'));
    expect(list.live.isConnected).toBe(true);
    list.clear();
    expect(list.live.textContent).toBe('');
  });

  it('gives each row Locate and Edit next to Delete, named by row number', async () => {
    const panel = document.createElement('div');
    await createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One'), annotation('annotation-2', 'Two')])).render();
    const rows = [...panel.querySelectorAll('[data-annotation-row]')];
    expect(rows.map((row) => [...row.querySelectorAll('button')].map((button) => button.textContent))).toEqual([
      ['Locate', 'Edit', 'Delete'],
      ['Locate', 'Edit', 'Delete'],
    ]);
    expect(rows[1]?.querySelector('[data-annotation-locate]')?.getAttribute('aria-label')).toBe('Locate annotation 2');
    expect(rows[1]?.querySelector('[data-annotation-row-edit]')?.getAttribute('aria-label')).toBe('Edit annotation 2');
    expect(rows[0]?.querySelector('[data-annotation-locate]')?.getAttribute('aria-label')).toBe('Locate annotation 1');
  });

  it('Locate scrolls the anchored element into view and flashes the shared highlight in the shell root', async () => {
    vi.useFakeTimers();
    const { panel, root } = mounted();
    const target = anchor('annotation-1');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 5, y: 6, width: 7, height: 8 }));
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One')]));
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-locate]')!.click();

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    const highlight = root.querySelector<HTMLElement>(':scope > [data-annotation-scan-highlight]');
    expect([highlight?.style.position, highlight?.style.top, highlight?.style.left]).toEqual(['fixed', '6px', '5px']);
    expect(panel.querySelector('[data-annotation-locate-missing]')).toBeNull();
    list.clear();
    expect(root.querySelector('[data-annotation-scan-highlight]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Locate on a stale anchor shows Element not found on that row, announces it, and moves nothing', async () => {
    const { panel, root } = mounted();
    const other = anchor('annotation-2');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'Gone'), annotation('annotation-2', 'Here')]));
    root.append(list.live);
    await list.render();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-1"] [data-annotation-locate]')!.click();
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-1"] [data-annotation-locate]')!.click();

    const missing = panel.querySelectorAll('[data-annotation-locate-missing]');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.closest('[data-annotation-id]')?.getAttribute('data-annotation-id')).toBe('annotation-1');
    expect(missing[0]?.textContent).toBe('Element not found on this page');
    expect(list.live.textContent).toBe('Element not found on this page');
    expect(root.querySelector('[data-annotation-scan-highlight]')).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    expect(other.scrollIntoView).not.toHaveBeenCalled();
  });

  it('Edit asks the host to open the note panel on that annotation', async () => {
    const panel = document.createElement('div');
    const annotations = [annotation('annotation-1', 'One'), annotation('annotation-2', 'Two')];
    const onEdit = vi.fn((event: Event) => (event as CustomEvent<Annotation>).detail);
    panel.addEventListener(ANNOTATION_EDIT_EVENT, onEdit);
    const store = persistence(annotations);
    await createAnnotationList(panel, pageUrl, store).render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-2"] [data-annotation-row-edit]')!.click();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.results[0]?.value).toEqual(annotations[1]);
    expect(store.sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('names Delete by row number and puts no annotation id in any accessible name', async () => {
    const panel = document.createElement('div');
    const ids = ['3f2a9c1e-0000-4000-8000-000000000001', '3f2a9c1e-0000-4000-8000-000000000002'];
    await createAnnotationList(panel, pageUrl, persistence(ids.map((id) => annotation(id, id.slice(-1))))).render();
    const rows = [...panel.querySelectorAll('[data-annotation-row]')];
    expect(rows[1]?.querySelector('[data-annotation-delete]')?.getAttribute('aria-label')).toBe('Delete annotation 2');
    expect(rows[0]?.querySelector('[data-annotation-delete]')?.getAttribute('aria-label')).toBe('Delete annotation 1');
    for (const element of panel.querySelectorAll('[aria-label]')) {
      for (const id of ids) expect(element.getAttribute('aria-label')).not.toContain(id);
    }
  });

  it('Locate on a live anchor announces that the annotation was located', async () => {
    const { panel, root } = mounted();
    anchor('annotation-2');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'Gone'), annotation('annotation-2', 'Here')]));
    root.append(list.live);
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-1"] [data-annotation-locate]')!.click();
    expect(list.live.textContent).toBe('Element not found on this page');
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="annotation-2"] [data-annotation-locate]')!.click();
    expect(list.live.textContent).toBe('Annotation 2 located.');
    list.clear();
  });

  it('announces a successful Download in the live region and the visible status', async () => {
    const { panel, root } = mounted();
    const delivery: AnnotationExportDelivery = { copy: vi.fn(), download: vi.fn(), downloadAsset: vi.fn() };
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One', 'image/webp')]), delivery);
    root.append(list.live);
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-export-download]')!.click();
    await vi.waitFor(() => expect(list.live.textContent).toBe('Download started for annotations.md and 1 image file.'));
    expect(delivery.downloadAsset).toHaveBeenCalledTimes(1);
    expect(panel.querySelector('[data-annotation-status=""]')?.textContent).toBe('Download started for annotations.md and 1 image file.');
  });
});
