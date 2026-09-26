// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    readCaptureShortcut: vi.fn().mockResolvedValue('Alt+Q'),
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
      'Click Annotate or press Alt+Q, then click any element to leave a note.',
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

  describe('first How it works step names the capture shortcut', () => {
    const SET = 'Click Annotate or press Alt+Q, then click any element to leave a note.';
    const UNSET = "Click Annotate, then click any element to leave a note. No keyboard shortcut is set; you can add one in your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager).";
    const FAILED = "Click Annotate, then click any element to leave a note. You can set a keyboard shortcut in your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager).";
    const KEY_TOKEN = /\b(Ctrl|Control|Alt|Shift|Cmd|Command|MacCtrl)\b|⌘|⇧/;

    async function firstStep(shortcut: Promise<string>): Promise<string> {
      const panel = document.createElement('div');
      const store = persistence([]);
      vi.mocked(store.readCaptureShortcut).mockReturnValue(shortcut);
      await createAnnotationList(panel, pageUrl, store).render();
      return panel.querySelector('[data-annotation-onboarding] ol > li')?.textContent ?? '';
    }

    function expectNoDefault(step: string): void {
      for (const banned of ['Ctrl+Shift', 'Control+Shift', 'Period', 'default shortcut']) {
        expect(step).not.toContain(banned);
      }
    }

    it('names the set shortcut', async () => {
      expect(await firstStep(Promise.resolve('Alt+Q'))).toBe(SET);
    });

    it('says no shortcut is set when the shortcut is empty', async () => {
      expect(await firstStep(Promise.resolve(''))).toBe(UNSET);
    });

    it('names no key when the shortcut read fails', async () => {
      expect(await firstStep(Promise.reject(new Error('no background')))).toBe(FAILED);
    });

    it('carries no hard-coded default shortcut in any state', async () => {
      expectNoDefault(await firstStep(Promise.resolve('Alt+Q')));
      for (const step of [await firstStep(Promise.resolve('')), await firstStep(Promise.reject(new Error('down')))]) {
        expectNoDefault(step);
        expect(step).not.toMatch(KEY_TOKEN);
      }
    });
  });
});

describe('re-reads the capture shortcut when the page becomes visible', () => {
  const SET = 'Click Annotate or press Alt+Q, then click any element to leave a note.';
  const FAILED = "Click Annotate, then click any element to leave a note. You can set a keyboard shortcut in your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager).";
  let visibility: DocumentVisibilityState;
  const firstStep = (panel: HTMLElement) => panel.querySelector('[data-annotation-onboarding] ol > li')?.textContent;
  const becomeVisible = () => {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => vi.restoreAllMocks());

  async function renderUnset(annotations: Annotation[] = []) {
    const panel = document.createElement('div');
    const store = persistence(annotations);
    vi.mocked(store.readCaptureShortcut).mockResolvedValueOnce('');
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    return { panel, store, list };
  }

  it('updates the first step to the set shortcut on a visible event', async () => {
    const { panel, list } = await renderUnset();
    expect(firstStep(panel)).not.toBe(SET);
    becomeVisible();
    await vi.waitFor(() => expect(firstStep(panel)).toBe(SET));
    list.clear();
  });

  it('makes no read on a visibilitychange while hidden', async () => {
    const { store, list } = await renderUnset();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(1);
    list.clear();
  });

  it('makes no read on a visible event after clear()', async () => {
    const { store, list } = await renderUnset();
    list.clear();
    becomeVisible();
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one read per visible event after render() twice', async () => {
    const { store, list } = await renderUnset();
    await list.render();
    becomeVisible();
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(3);
    list.clear();
  });

  it('keeps the heading and details nodes, the pressed chip and the details open state', async () => {
    const { panel, list } = await renderUnset([annotation('a', 'One'), { ...annotation('b', 'Two'), status: 'resolved' }]);
    const heading = panel.querySelector('h2');
    const details = panel.querySelector<HTMLDetailsElement>('[data-annotation-onboarding]')!;
    panel.querySelector<HTMLButtonElement>('[data-annotation-filter-value="resolved"]')!.click();
    details.open = false;
    becomeVisible();
    await vi.waitFor(() => expect(firstStep(panel)).toBe(SET));
    expect(panel.querySelector('h2')).toBe(heading);
    expect(panel.querySelector('[data-annotation-onboarding]')).toBe(details);
    expect(details.open).toBe(false);
    expect(panel.querySelector('[data-annotation-filter-value="resolved"]')?.getAttribute('aria-pressed')).toBe('true');
    list.clear();
  });

  it('writes nothing when the read resolves after clear() or a newer render()', async () => {
    const { panel, store, list } = await renderUnset();
    let resolve!: (shortcut: string) => void;
    vi.mocked(store.readCaptureShortcut).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    becomeVisible();
    list.clear();
    resolve('Alt+Q');
    await new Promise((done) => setTimeout(done, 0));
    expect(panel.childNodes).toHaveLength(0);

    vi.mocked(store.readCaptureShortcut).mockResolvedValueOnce('');
    await list.render();
    const unset = firstStep(panel);
    vi.mocked(store.readCaptureShortcut).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    becomeVisible();
    vi.mocked(store.readCaptureShortcut).mockResolvedValueOnce('');
    await list.render();
    resolve('Alt+Q');
    await new Promise((done) => setTimeout(done, 0));
    expect(firstStep(panel)).toBe(unset);
    list.clear();
  });

  it('shows the failed step text when the read rejects', async () => {
    const { panel, store, list } = await renderUnset();
    vi.mocked(store.readCaptureShortcut).mockRejectedValueOnce(new Error('no background'));
    becomeVisible();
    await vi.waitFor(() => expect(firstStep(panel)).toBe(FAILED));
    list.clear();
  });

  it('updates the first step to the set shortcut on a window focus while visible', async () => {
    const { panel, list } = await renderUnset();
    expect(firstStep(panel)).not.toBe(SET);
    window.dispatchEvent(new FocusEvent('focus'));
    await vi.waitFor(() => expect(firstStep(panel)).toBe(SET));
    list.clear();
  });

  it('makes no read on a window focus after clear()', async () => {
    const { store, list } = await renderUnset();
    list.clear();
    window.dispatchEvent(new FocusEvent('focus'));
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(1);
  });

  it('makes no read on a window focus while hidden', async () => {
    const { store, list } = await renderUnset();
    visibility = 'hidden';
    window.dispatchEvent(new FocusEvent('focus'));
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(1);
    list.clear();
  });

  it('makes exactly one read per window focus after render() twice', async () => {
    const { store, list } = await renderUnset();
    await list.render();
    window.dispatchEvent(new FocusEvent('focus'));
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(3);
    list.clear();
  });

  it('makes no read on a focus event inside the document', async () => {
    const { panel, store, list } = await renderUnset();
    document.body.append(panel);
    panel.querySelector('h2')!.dispatchEvent(new FocusEvent('focus'));
    expect(store.readCaptureShortcut).toHaveBeenCalledTimes(1);
    list.clear();
    panel.remove();
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

  it('marks row Delete and Clear all as danger', async () => {
    const { panel } = mounted();
    await createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One')])).render();
    expect(panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')?.dataset.variant).toBe('danger');
    expect(panel.querySelector<HTMLButtonElement>('[data-annotation-clear]')?.dataset.variant).toBe('danger');
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

  it('numbers each row with the same position text as its pin, in list order', async () => {
    const { panel } = mounted();
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('a', 'One'), annotation('b', 'Two'), annotation('c', 'Three')]));
    await list.render();
    expect([...panel.querySelectorAll('[data-annotation-row] > [data-annotation-position]')].map((node) => node.textContent)).toEqual(['1', '2', '3']);
    expect(panel.querySelector('[data-annotation-badge]')).toBeNull();
  });

  it('labels the row hint from the element context and keeps the raw selector in its title', async () => {
    const { panel } = mounted();
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('annotation-1', 'One')]));
    await list.render();
    const hint = panel.querySelector('[data-annotation-hint]');
    expect(hint?.textContent).toBe('button#target "Target"');
    expect(hint?.getAttribute('title')).toBe('#target-annotation-1');
  });

  it('falls back to the selector as the hint when the element context has no label', async () => {
    const { panel } = mounted();
    const bare = { ...annotation('annotation-1', 'One'), elementContext: { ...elementContext, tagName: '', id: '', text: '  ' } };
    const list = createAnnotationList(panel, pageUrl, persistence([bare]));
    await list.render();
    const hint = panel.querySelector('[data-annotation-hint]');
    expect(hint?.textContent).toBe('#target-annotation-1');
    expect(hint?.getAttribute('title')).toBe('#target-annotation-1');
  });

  it('shows the status as an Open or Resolved chip on the status element', async () => {
    const { panel } = mounted();
    const resolved: Annotation = { ...annotation('b', 'Two'), status: 'resolved' };
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('a', 'One'), resolved]));
    await list.render();
    expect(panel.querySelector('[data-annotation-id="a"] [data-annotation-status="open"]')?.textContent).toBe('Open');
    expect(panel.querySelector('[data-annotation-id="b"] [data-annotation-status="resolved"]')?.textContent).toBe('Resolved');
  });

  it('pre-flags a row whose element is missing at render, without announcing it', async () => {
    const { panel, root } = mounted();
    anchor('here');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('gone', 'Gone'), annotation('here', 'Here')]));
    root.append(list.live);
    await list.render();
    const missing = panel.querySelectorAll('[data-annotation-locate-missing]');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.closest('[data-annotation-id]')?.getAttribute('data-annotation-id')).toBe('gone');
    expect(missing[0]?.textContent).toBe('Element not found on this page');
    expect(panel.querySelector('[data-annotation-id="here"] [data-annotation-locate-missing]')).toBeNull();
    expect(list.live.textContent).toBe('');
  });

  it('Locate on a pre-flagged row whose element now exists removes the flag', async () => {
    const { panel } = mounted();
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('late', 'Late')]));
    await list.render();
    expect(panel.querySelector('[data-annotation-locate-missing]')).not.toBeNull();
    anchor('late');
    panel.querySelector<HTMLButtonElement>('[data-annotation-locate]')!.click();
    expect(panel.querySelector('[data-annotation-locate-missing]')).toBeNull();
    list.clear();
  });

  it('Locate on a pre-flagged missing element keeps a single flag and announces it', async () => {
    const { panel, root } = mounted();
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('gone', 'Gone')]));
    root.append(list.live);
    await list.render();
    panel.querySelector<HTMLButtonElement>('[data-annotation-locate]')!.click();
    expect(panel.querySelectorAll('[data-annotation-locate-missing]')).toHaveLength(1);
    expect(list.live.textContent).toBe('Element not found on this page');
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

describe('annotation list status filter', () => {
  const mixed = (): Annotation[] => [
    annotation('a', 'One'),
    { ...annotation('b', 'Two'), status: 'resolved' },
    annotation('c', 'Three'),
  ];
  const chip = (panel: HTMLElement, value: string) =>
    panel.querySelector(`[data-annotation-filter-value="${value}"]`) as HTMLButtonElement;
  const visibleIds = (panel: HTMLElement) =>
    [...panel.querySelectorAll<HTMLElement>('[data-annotation-row]')].filter((row) => !row.hidden).map((row) => row.dataset.annotationId);
  const pressed = (panel: HTMLElement) =>
    [...panel.querySelectorAll('[data-annotation-filter-value]')].filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => (button as HTMLElement).dataset.annotationFilterValue);
  const visibleEmpty = (panel: HTMLElement) => {
    const empty = panel.querySelector<HTMLElement>('[data-annotation-filter-empty]');
    return empty && !empty.hidden ? empty.textContent : null;
  };

  it('renders All, Open and Resolved chips with counts between export and rows, All pressed by default', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('a', 'One'), annotation('b', 'Two')]));
    await list.render();
    const group = panel.querySelector('[data-annotation-filter]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filter by status');
    expect(group.previousElementSibling?.hasAttribute('data-annotation-export')).toBe(true);
    expect(group.compareDocumentPosition(panel.querySelector('[data-annotation-rows]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['All (2)', 'Open (2)', 'Resolved (0)']);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
    expect(pressed(panel)).toEqual(['all']);
    expect(visibleIds(panel)).toEqual(['a', 'b']);
    expect(visibleEmpty(panel)).toBeNull();
  });

  it('hides rows whose status differs from the picked chip and presses only that chip', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence(mixed()));
    await list.render();
    chip(panel, 'open').click();
    expect(visibleIds(panel)).toEqual(['a', 'c']);
    expect(pressed(panel)).toEqual(['open']);
    chip(panel, 'resolved').click();
    expect(visibleIds(panel)).toEqual(['b']);
    expect(pressed(panel)).toEqual(['resolved']);
    chip(panel, 'all').click();
    expect(visibleIds(panel)).toEqual(['a', 'b', 'c']);
    expect(pressed(panel)).toEqual(['all']);
  });

  it('shows No open annotations. when the Open filter leaves no row', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([{ ...annotation('a', 'One'), status: 'resolved' }]));
    await list.render();
    chip(panel, 'open').click();
    expect(visibleIds(panel)).toEqual([]);
    expect(visibleEmpty(panel)).toBe('No open annotations.');
    expect(panel.querySelector('[data-annotation-filter]')?.nextElementSibling?.hasAttribute('data-annotation-filter-empty')).toBe(true);
    chip(panel, 'all').click();
    expect(visibleEmpty(panel)).toBeNull();
  });

  it('shows No resolved annotations. when the Resolved filter leaves no row', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([annotation('a', 'One')]));
    await list.render();
    chip(panel, 'resolved').click();
    expect(visibleIds(panel)).toEqual([]);
    expect(visibleEmpty(panel)).toBe('No resolved annotations.');
  });

  it('keeps the picked filter across a re-render after a delete and across clear()', async () => {
    const panel = document.createElement('div');
    const store = persistence(mixed());
    const list = createAnnotationList(panel, pageUrl, store);
    await list.render();
    chip(panel, 'resolved').click();
    vi.mocked(store.listAnnotations).mockResolvedValue([annotation('a', 'One'), { ...annotation('b', 'Two'), status: 'resolved' }]);
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelectorAll('[data-annotation-row]')).toHaveLength(2));
    expect(pressed(panel)).toEqual(['resolved']);
    expect(visibleIds(panel)).toEqual(['b']);
    list.clear();
    await list.render();
    expect(pressed(panel)).toEqual(['resolved']);
    expect(visibleIds(panel)).toEqual(['b']);
  });

  it('announces the picked filter and keeps focus on the pressed chip', async () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const list = createAnnotationList(panel, pageUrl, persistence(mixed()));
    await list.render();
    for (const [value, text] of [['open', 'Showing open annotations'], ['resolved', 'Showing resolved annotations'], ['all', 'Showing all annotations']]) {
      chip(panel, value!).focus();
      chip(panel, value!).click();
      expect(list.live.textContent).toBe(text);
      expect(document.activeElement).toBe(chip(panel, value!));
    }
    panel.remove();
  });

  it('keeps each row position number when rows before it are filtered out', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence(mixed()));
    await list.render();
    chip(panel, 'resolved').click();
    const visible = [...panel.querySelectorAll<HTMLElement>('[data-annotation-row]')].filter((row) => !row.hidden);
    expect(visible.map((row) => row.querySelector('[data-annotation-position]')?.textContent)).toEqual(['2']);
    chip(panel, 'open').click();
    const open = [...panel.querySelectorAll<HTMLElement>('[data-annotation-row]')].filter((row) => !row.hidden);
    expect(open.map((row) => row.querySelector('[data-annotation-position]')?.textContent)).toEqual(['1', '3']);
  });

  it('renders no filter row when the page has no annotations', async () => {
    const panel = document.createElement('div');
    const list = createAnnotationList(panel, pageUrl, persistence([]));
    await list.render();
    expect(panel.querySelector('[data-annotation-filter]')).toBeNull();
    expect(panel.querySelector('[data-annotation-filter-empty]')).toBeNull();
  });
});
