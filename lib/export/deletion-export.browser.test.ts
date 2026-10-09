import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ElementContext } from '../capture/context';
import type { AnnotationInput } from '../annotation';
import { createAnnotationList } from '../annotation-list/annotation-list';
import { sendAnnotationWrite } from '../annotation-messages';
import { addAnnotation, listAllAnnotations, listAnnotations } from '../annotation-storage';
import { createBlobStore } from '../blob-store';
import { createNotePanel } from '../notes/note-panel';
import { exportJson } from '../json-io';
import { buildOverlayShell } from '../ui/shell';
import { registerBackgroundMessageHandlers } from '../wiring/background-messages';
import { exportAllPages } from './all-pages';

const pageA = 'https://example.com/docs';
const pageB = 'https://example.com/other';
const selector = '#target';

function input(note: string, pageUrl: string): AnnotationInput {
  const elementContext: ElementContext = {
    selector, tagName: 'BUTTON', id: 'target', classList: [], text: 'Target',
    boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: pageUrl,
    viewport: { width: 1280, height: 720 }, sourcePath: null,
  };
  return { note, selector, elementContext };
}

function context(pageUrl: string): ElementContext {
  return input('', pageUrl).elementContext;
}

function mountShell() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  return buildOverlayShell(container);
}

// The popup's export buttons, with the same collect and delivery wiring as entrypoints/popup/main.ts.
async function exportEverything() {
  const blobStore = createBlobStore();
  let json = '';
  let markdown = '';
  const jsonStatus = await exportJson({
    collect: listAllAnnotations,
    blobStore,
    download: (text) => { json = text; },
    copy: async () => {},
  });
  const markdownStatus = await exportAllPages({
    collect: listAllAnnotations,
    readBlob: (key) => blobStore.get(key),
    delivery: {
      copy: async () => {},
      download: (text) => { markdown = text; },
      downloadAsset: () => {},
    },
  });
  return { json, markdown, jsonStatus, markdownStatus, notes: (JSON.parse(json) as { note: string }[]).map((item) => item.note) };
}

beforeEach(() => {
  fakeBrowser.reset();
  registerBackgroundMessageHandlers({ blobStore: createBlobStore() });
});

describe('deletion reaches the exports (real background, storage, and export path)', () => {
  it('a note-panel Delete removes that annotation from the JSON and Markdown exports and keeps other pages', async () => {
    const deleted = await addAnnotation(pageA, input('Delete me', pageA));
    const kept = await addAnnotation(pageA, input('Keep on page A', pageA));
    await addAnnotation(pageB, input('Keep on page B', pageB));
    const shell = mountShell();
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      readBlob: vi.fn(),
      addAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(),
      revertCssEdits: vi.fn(),
      revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);
    await notePanel.render(context(pageA));

    const card = `article[data-annotation-id="${deleted.id}"]`;
    shell.panel.querySelector<HTMLButtonElement>(`${card} [data-annotation-delete]`)!.click();
    await userEvent.click(shell.panel.querySelector<HTMLElement>(`${card} [data-annotation-delete-confirm]`)!);

    await vi.waitFor(async () => expect(await listAnnotations(pageA)).toEqual([expect.objectContaining({ id: kept.id })]));
    const exported = await exportEverything();
    expect(exported.jsonStatus).toBe('Exported 2 annotations.');
    expect(exported.markdownStatus).toBe('Exported 2 annotations and 0 assets.');
    expect(exported.json).not.toContain(deleted.id);
    expect(exported.notes).toEqual(['Keep on page A', 'Keep on page B']);
    expect(exported.markdown).not.toContain('Delete me');
    expect(exported.markdown).toContain('Keep on page A');
    expect(exported.markdown).toContain('Keep on page B');
    document.body.replaceChildren();
  });

  it('Clear all on a page removes that page from the JSON and Markdown exports and keeps other pages', async () => {
    await addAnnotation(pageA, input('Clear one', pageA));
    await addAnnotation(pageA, input('Clear two', pageA));
    await addAnnotation(pageB, input('Keep on page B', pageB));
    const shell = mountShell();
    const list = createAnnotationList(shell.panel, pageA, {
      listAnnotations,
      sendAnnotationWrite,
      readBlob: vi.fn(),
      readOnboardingOpen: async () => false,
      writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    shell.root.append(list.live);
    await list.render();

    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-clear]')!.click();
    await userEvent.click(shell.panel.querySelector<HTMLElement>('[data-annotation-clear-confirm]')!);

    await vi.waitFor(async () => expect(await listAnnotations(pageA)).toEqual([]));
    const exported = await exportEverything();
    expect(exported.jsonStatus).toBe('Exported 1 annotation.');
    expect(exported.markdownStatus).toBe('Exported 1 annotation and 0 assets.');
    expect(exported.notes).toEqual(['Keep on page B']);
    expect(exported.markdown).not.toContain('Clear one');
    expect(exported.markdown).not.toContain('Clear two');
    expect(exported.markdown).toContain('Keep on page B');
    document.body.replaceChildren();
  });
});
