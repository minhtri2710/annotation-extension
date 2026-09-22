import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Annotation } from '../annotation';
import { importAll, JsonImportError, parseImport, serialize } from './index';
import type { AnnotationAddMessage, JsonAnnotationWriter } from './index';
import type { ScreenshotStore } from '../screenshot/store';

const firstPage = 'https://example.com/docs?mode=full#intro';
const secondPage = 'https://example.com/settings';
const firstElementContext = {
  selector: 'form button[type="submit"]',
  tagName: 'BUTTON',
  id: 'submit',
  classList: ['primary'],
  text: 'Submit',
  boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  url: firstPage,
  viewport: { width: 1280, height: 720 },
  sourcePath: { fileName: 'src/Form.tsx', lineNumber: 12 },
};
const secondElementContext = {
  selector: '#account-setting',
  tagName: 'SECTION',
  id: 'account-setting',
  classList: [],
  text: 'Account',
  boundingBox: { x: 0, y: 0, width: 200, height: 100 },
  url: secondPage,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

class MemoryScreenshotStore implements ScreenshotStore {
  readonly blobs = new Map<string, Blob>();
  failPut = false;
  async put(id: string, blob: Blob): Promise<void> {
    if (this.failPut) throw new Error('blob write failed');
    this.blobs.set(id, blob);
  }
  async get(id: string): Promise<Blob | undefined> { return this.blobs.get(id); }
  async delete(ids: string[]): Promise<void> { for (const id of ids) this.blobs.delete(id); }
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'annotation-first',
    pageUrl: firstPage,
    note: 'Check the submit button',
    selector: firstElementContext.selector,
    elementContext: { ...firstElementContext, sourcePath: { fileName: 'src/Form.tsx', lineNumber: 42 } },
    createdAt: '2024-02-01T10:00:00.000Z',
    updatedAt: '2024-02-01T10:05:00.000Z',
    repro: {
      steps: ['Open the form', 'Click Submit'],
      expected: 'The form is submitted',
      actual: 'An inline error appears',
    },
    cssEdits: [{ property: 'border-color', value: 'red' }],
    ...overrides,
  };
}

beforeEach(() => fakeBrowser.reset());

describe('JSON annotation I/O', () => {
  it('round-trips annotation inputs across pages without IDs or timestamps', async () => {
    const store = new MemoryScreenshotStore();
    const blob = new Blob(['shot'], { type: 'image/webp' });
    await store.put('annotation-first', blob);
    const firstAnnotation = annotation({
      screenshot: { mimeType: 'image/webp', width: 800, height: 400, byteLength: blob.size },
    });
    const secondAnnotation: Annotation = {
      id: 'annotation-second',
      pageUrl: secondPage,
      note: 'Review account setting',
      selector: '#account-setting',
      elementContext: secondElementContext,
      createdAt: '2024-02-02T11:00:00.000Z',
      updatedAt: '2024-02-02T11:00:00.000Z',
    };

    const plan = parseImport(await serialize([firstAnnotation, secondAnnotation], store));

    expect(plan).toEqual([
      {
        pageUrl: firstPage,
        input: {
          note: firstAnnotation.note,
          selector: firstAnnotation.selector,
          elementContext: firstAnnotation.elementContext,
          repro: firstAnnotation.repro,
          cssEdits: firstAnnotation.cssEdits,
        },
        screenshot: expect.objectContaining({ mimeType: 'image/webp', blob: expect.any(Blob) }),
      },
      {
        pageUrl: secondPage,
        input: {
          note: secondAnnotation.note,
          selector: secondAnnotation.selector,
          elementContext: secondAnnotation.elementContext,
        },
      },
    ]);
    expect(plan[0]?.pageUrl).toBe(firstPage);
    expect(plan[0]?.input).toEqual({
      note: firstAnnotation.note,
      selector: firstAnnotation.selector,
      elementContext: firstAnnotation.elementContext,
      repro: firstAnnotation.repro,
      cssEdits: firstAnnotation.cssEdits,
    });
    expect(plan[0]?.screenshot?.mimeType).toBe('image/webp');
    expect(await plan[0]!.screenshot!.blob.text()).toBe('shot');
    expect(plan[1]).toEqual({
      pageUrl: secondPage,
      input: {
        note: secondAnnotation.note,
        selector: secondAnnotation.selector,
        elementContext: secondAnnotation.elementContext,
      },
    });
    expect(plan[0]?.input).not.toHaveProperty('id');
    expect(plan[0]?.input).not.toHaveProperty('createdAt');
    expect(plan[0]?.input).not.toHaveProperty('updatedAt');
  });

  it('rejects malformed JSON and a JSON object instead of the expected array', () => {
    expect(() => parseImport('{not-json')).toThrow(JsonImportError);
    expect(() => parseImport(JSON.stringify({ annotations: [] }))).toThrow(JsonImportError);
    const base = { pageUrl: firstPage, note: 'x', selector: '#x', elementContext: firstElementContext };
    expect(() => parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/svg+xml', base64: 'x' } }]))).toThrow('Unsupported screenshot mime type');
    expect(() => parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/png', base64: 'not base64 ???' } }]))).toThrow(JsonImportError);
    const oversized = btoa('x'.repeat(2 * 1024 * 1024 + 1));
    expect(() => parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/png', base64: oversized } }]))).toThrow('2 MB');
  });

  it('drops array entries missing required fields while retaining valid entries', () => {
    const invalidEntry = { pageUrl: firstPage, note: 'Missing selector and element context' };
    const invalidContextEntry = {
      pageUrl: firstPage,
      note: 'Invalid element context',
      selector: '#target',
      elementContext: { ...secondElementContext, classList: 'not-an-array' },
    };
    const validEntry = {
      pageUrl: secondPage,
      note: 'Valid',
      selector: secondElementContext.selector,
      elementContext: secondElementContext,
    };

    expect(parseImport(JSON.stringify([invalidEntry, invalidContextEntry, validEntry]))).toEqual([
      {
        pageUrl: secondPage,
        input: {
          note: validEntry.note,
          selector: validEntry.selector,
          elementContext: validEntry.elementContext,
        },
      },
    ]);
  });

  it('writes a screenshot Blob before metadata and leaves no metadata on Blob failure', async () => {
    const store = new MemoryScreenshotStore();
    store.failPut = true;
    const plan = parseImport(JSON.stringify([{
      pageUrl: firstPage,
      note: 'With image', selector: '#target', elementContext: firstElementContext,
      screenshot: { mimeType: 'image/png', base64: btoa('shot') },
    }]));

    await expect(importAll(plan, store, async () => ({ width: 10, height: 10 }))).rejects.toThrow('blob write failed');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('imports non-screenshot entries and screenshot entries with injected dimensions', async () => {
    const store = new MemoryScreenshotStore();
    const plan = parseImport(JSON.stringify([{
      pageUrl: firstPage,
      note: 'With image', selector: '#target', elementContext: firstElementContext,
      screenshot: { mimeType: 'image/png', base64: btoa('shot') },
    }]));
    await importAll(plan, store, async () => ({ width: 10, height: 20 }));
    const stored = await fakeBrowser.storage.local.get(null);
    const entries = Object.values(stored).flatMap((value) => Array.isArray(value) ? value : []);
    expect(entries).toHaveLength(1);
    const imported = entries[0] as Annotation;
    expect(imported.screenshot).toEqual({ mimeType: 'image/png', width: 10, height: 20, byteLength: 4 });
    expect(await store.get(imported.id)).toBeDefined();
  });

  it('sends one exact annotation.add message for each import entry', async () => {
    const plan = parseImport(JSON.stringify([
      {
        pageUrl: firstPage,
        note: 'First',
        selector: firstElementContext.selector,
        elementContext: firstElementContext,
      },
      {
        pageUrl: secondPage,
        note: 'Second',
        selector: secondElementContext.selector,
        elementContext: secondElementContext,
      },
    ]));
    const sent: AnnotationAddMessage[] = [];
    const write: JsonAnnotationWriter = vi.fn(async (message) => {
      sent.push(message);
      return {
        id: `created-${sent.length}`,
        pageUrl: message.pageUrl,
        ...message.input,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
    });

    await importAll(plan, new MemoryScreenshotStore(), async () => ({ width: 1, height: 1 }), write);

    expect(write).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([
      { type: 'annotation.add', pageUrl: firstPage, input: plan[0]!.input },
      { type: 'annotation.add', pageUrl: secondPage, input: plan[1]!.input },
    ]);
  });
});
