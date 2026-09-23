import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Annotation } from '../annotation';
import { exportJson, importAll, importJson, JsonImportError, parseImport, serialize } from './index';
import { attachmentKey, screenshotKey, type BlobStore } from '../blob-store';
import { attachmentAssetFilename, screenshotAssetFilename } from '../export/format';

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

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Blob>();
  failPut = false;
  failPutAt = 0;
  puts = 0;
  async put(id: string, blob: Blob): Promise<void> {
    this.puts += 1;
    if (this.failPut || this.puts === this.failPutAt) throw new Error('blob write failed');
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
    status: 'open',
    repro: {
      steps: ['Open the form', 'Click Submit'],
      expected: 'The form is submitted',
      actual: 'An inline error appears',
    },
    cssEdits: [{ property: 'border-color', value: 'red', original: 'rgb(0, 0, 0)' }],
    ...overrides,
  };
}

const dimensions = async () => ({ width: 10, height: 20 });

function rawEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'entry-1',
    pageUrl: firstPage,
    note: 'x',
    selector: '#x',
    elementContext: firstElementContext,
    status: 'open',
    createdAt: '2024-02-01T10:00:00.000Z',
    updatedAt: '2024-02-01T10:00:00.000Z',
    ...overrides,
  };
}

async function storedAnnotations(): Promise<Annotation[]> {
  return Object.values(await fakeBrowser.storage.local.get(null)).flatMap((value) => Array.isArray(value) ? value : []) as Annotation[];
}

beforeEach(() => fakeBrowser.reset());

describe('JSON annotation I/O', () => {
  it('round-trips annotations across pages with their ids and timestamps', async () => {
    const store = new MemoryBlobStore();
    const blob = new Blob(['shot'], { type: 'image/webp' });
    await store.put('screenshot:annotation-first', blob);
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
      status: 'open',
    };

    const plan = await parseImport((await serialize([firstAnnotation, secondAnnotation], store)).json, async () => ({ width: 800, height: 400 }));

    expect(plan).toEqual([
      {
        annotation: firstAnnotation,
        blobs: [['screenshot:annotation-first', expect.any(Blob)]],
      },
      {
        annotation: secondAnnotation,
        blobs: [],
      },
    ]);
    expect(await plan[0]!.blobs[0]![1].text()).toBe('shot');
    expect(plan[0]!.blobs[0]![1].type).toBe('image/webp');
  });

  it('rejects malformed JSON and a JSON object instead of the expected array', async () => {
    await expect(parseImport('{not-json', dimensions)).rejects.toThrow(JsonImportError);
    await expect(parseImport(JSON.stringify({ annotations: [] }), dimensions)).rejects.toThrow(JsonImportError);
    const base = rawEntry();
    await expect(parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/svg+xml', base64: 'x' } }]), dimensions)).rejects.toThrow('unsupported screenshot type');
    await expect(parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/png', base64: 'not base64 ???' } }]), dimensions)).rejects.toThrow(JsonImportError);
    await expect(parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/png', base64: '' } }]), dimensions)).rejects.toThrow('must not be empty');
    await expect(parseImport(JSON.stringify([{ ...base, cssEdits: [{ property: 'color', value: 'red' }] }]), dimensions)).rejects.toThrow('invalid CSS edits');
    const oversized = btoa('x'.repeat(2 * 1024 * 1024 + 1));
    await expect(parseImport(JSON.stringify([{ ...base, screenshot: { mimeType: 'image/png', base64: oversized } }]), dimensions)).rejects.toThrow('2 MB');
  });

  it('rejects the whole file when any entry misses required fields, naming the entry', async () => {
    const invalidEntry = { pageUrl: firstPage, note: 'Missing selector and element context' };
    const invalidContextEntry = {
      ...rawEntry({ id: 'bad-context' }),
      elementContext: { ...secondElementContext, classList: 'not-an-array' },
    };
    const validEntry = rawEntry({ id: 'valid', pageUrl: secondPage });

    await expect(parseImport(JSON.stringify([validEntry, invalidEntry, invalidContextEntry]), dimensions)).rejects.toThrow(
      'Import failed: entry 2 has no annotation id. Nothing was imported.',
    );
    await expect(parseImport(JSON.stringify([validEntry, invalidContextEntry]), dimensions)).rejects.toThrow(
      'Import failed: entry 2 has invalid element details. Nothing was imported.',
    );
  });

  it('writes a screenshot Blob before metadata and leaves no metadata on Blob failure', async () => {
    const store = new MemoryBlobStore();
    store.failPut = true;
    const plan = await parseImport(JSON.stringify([rawEntry({
      note: 'With image', selector: '#target',
      screenshot: { mimeType: 'image/png', base64: btoa('shot') },
    })]), async () => ({ width: 10, height: 10 }));

    await expect(importAll(plan, store)).rejects.toThrow('Import failed while saving entry 1. Nothing was imported.');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('imports non-screenshot entries and screenshot entries with injected dimensions', async () => {
    const store = new MemoryBlobStore();
    const plan = await parseImport(JSON.stringify([rawEntry({
      note: 'With image', selector: '#target',
      screenshot: { mimeType: 'image/png', base64: btoa('shot') },
    })]), async () => ({ width: 10, height: 20 }));
    await importAll(plan, store);
    const entries = await storedAnnotations();
    expect(entries).toHaveLength(1);
    const imported = entries[0] as Annotation;
    expect(imported.screenshot).toEqual({ mimeType: 'image/png', width: 10, height: 20, byteLength: 4 });
    expect(await store.get(`screenshot:${imported.id}`)).toBeDefined();
  });

  it('round-trips status and attachments through JSON', async () => {
    const store = new MemoryBlobStore();
    const attachmentBlob = new Blob(['attach'], { type: 'image/png' });
    await store.put('attachment:attachment-1', attachmentBlob);
    const source = annotation({
      status: 'resolved',
      attachments: [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: attachmentBlob.size }],
    });
    const exported = JSON.parse((await serialize([source], store)).json) as [{ status: string; attachments: [{ id: string; name: string; mimeType: string; base64: string }] }];
    expect(exported[0].status).toBe('resolved');
    expect(exported[0].attachments).toEqual([{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', base64: btoa('attach') }]);
    const plan = await parseImport(JSON.stringify(exported), dimensions);
    expect(plan[0]?.annotation.status).toBe('resolved');
    expect(plan[0]?.annotation.attachments?.[0]?.name).toBe('photo.png');
  });

  it('rejects invalid attachment JSON and preserves Blob-before-metadata ordering', async () => {
    const base = rawEntry();
    await expect(parseImport(JSON.stringify([{ ...base, attachments: [{ id: 'a', name: 'x.png', mimeType: 'image/svg+xml', base64: btoa('x') }] }]), dimensions)).rejects.toThrow('unsupported attachment type');
    await expect(parseImport(JSON.stringify([{ ...base, attachments: Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, name: 'x.png', mimeType: 'image/png', base64: btoa('x') })) }]), dimensions)).rejects.toThrow('more than 5');

    const store = new MemoryBlobStore();
    const order: string[] = [];
    const originalPut = store.put.bind(store);
    store.put = async (key, blob) => { order.push(`put:${key}`); await originalPut(key, blob); };
    const plan = await parseImport(JSON.stringify([{ ...base, attachments: [{ id: 'a', name: 'x.png', mimeType: 'image/png', base64: btoa('x') }] }]), dimensions);
    await importAll(plan, store);
    const stored = await storedAnnotations();
    expect(order[0]).toMatch(/^put:attachment:/);
    expect(stored[0]?.attachments).toHaveLength(1);
  });

  it('writes one annotation per import entry to its own page, in file order', async () => {
    const plan = await parseImport(JSON.stringify([
      rawEntry({ id: 'first', note: 'First' }),
      rawEntry({ id: 'second', pageUrl: secondPage, note: 'Second', selector: secondElementContext.selector, elementContext: secondElementContext }),
    ]), dimensions);

    await expect(importAll(plan, new MemoryBlobStore())).resolves.toEqual({ imported: 2, skipped: 0 });

    const stored = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(stored).sort()).toEqual(['page:https://example.com/docs?mode=full', `page:${new URL(secondPage).toString()}`]);
    expect(await storedAnnotations()).toEqual(expect.arrayContaining([plan[0]!.annotation, plan[1]!.annotation]));
    expect((await storedAnnotations())).toHaveLength(2);
  });

  it('restores identity so ids, dates, attachment ids and Markdown asset filenames survive a round trip', async () => {
    const store = new MemoryBlobStore();
    const shot = new Blob(['shot'], { type: 'image/png' });
    const file = new Blob(['file'], { type: 'image/jpeg' });
    const source = annotation({
      screenshot: { mimeType: 'image/png', width: 30, height: 40, byteLength: shot.size },
      attachments: [{ id: 'attachment-keep', name: 'p.jpg', mimeType: 'image/jpeg', byteLength: file.size }],
    });
    await store.put(screenshotKey(source.id), shot);
    await store.put(attachmentKey('attachment-keep'), file);
    const { json } = await serialize([source], store);

    fakeBrowser.reset();
    const target = new MemoryBlobStore();
    await expect(importJson(json, target, async () => ({ width: 30, height: 40 }))).resolves.toBe('Imported 1 annotation, skipped 0 already present.');

    const [restored] = await storedAnnotations();
    expect(restored).toEqual(source);
    expect(screenshotAssetFilename(restored!.id, restored!.screenshot!.mimeType)).toBe(screenshotAssetFilename(source.id, 'image/png'));
    expect(attachmentAssetFilename(restored!.id, 0, restored!.attachments![0]!.mimeType)).toBe(attachmentAssetFilename(source.id, 0, 'image/jpeg'));
    expect(await target.get(screenshotKey(source.id))?.then((blob) => blob?.text())).toBe('shot');
    expect(await (await target.get(attachmentKey('attachment-keep')))?.text()).toBe('file');
  });

  it('skips entries whose id already exists on the target page and reports both counts', async () => {
    const store = new MemoryBlobStore();
    const json = JSON.stringify([rawEntry({ id: 'one' }), rawEntry({ id: 'two' })]);
    await expect(importJson(json, store, dimensions)).resolves.toBe('Imported 2 annotations, skipped 0 already present.');
    await expect(importJson(json, store, dimensions)).resolves.toBe('Imported 0 annotations, skipped 2 already present.');
    const third = JSON.stringify([rawEntry({ id: 'one' }), rawEntry({ id: 'three' })]);
    await expect(importJson(third, store, dimensions)).resolves.toBe('Imported 1 annotation, skipped 1 already present.');
    expect((await storedAnnotations()).map((entry) => entry.id).sort()).toEqual(['one', 'three', 'two']);
  });

  it('fails every invalid entry with its position and reason, and writes nothing', async () => {
    const valid = rawEntry({ id: 'valid' });
    const cases: [Record<string, unknown>, string][] = [
      [rawEntry({ id: 'e', pageUrl: 'not a url' }), 'has an invalid page URL'],
      [rawEntry({ id: 'e', note: 3 }), 'has no note'],
      [rawEntry({ id: 'e', selector: undefined }), 'has no selector'],
      [rawEntry({ id: 'e', status: 'done' }), 'has an invalid status'],
      [rawEntry({ id: 'e', status: undefined }), 'has an invalid status'],
      [rawEntry({ id: 'e', repro: { steps: 'one' } }), 'has invalid reproduction steps'],
      [rawEntry({ id: 'e', cssEdits: 'red' }), 'has invalid CSS edits'],
      [rawEntry({ id: undefined }), 'has no annotation id'],
      [rawEntry({ id: 'a:b' }), 'has an invalid annotation id'],
      [rawEntry({ id: 'e', createdAt: 'yesterday' }), 'has an invalid creation date'],
      [rawEntry({ id: 'e', updatedAt: undefined }), 'has an invalid update date'],
      [rawEntry({ id: 'valid' }), 'repeats annotation id valid'],
      [rawEntry({ id: 'e', attachments: [{ name: 'x.png', mimeType: 'image/png', base64: btoa('x') }] }), 'has an attachment without an id'],
      [rawEntry({ id: 'e', attachments: [{ id: 'dup', name: 'x.png', mimeType: 'image/png', base64: btoa('x') }, { id: 'dup', name: 'y.png', mimeType: 'image/png', base64: btoa('y') }] }), 'repeats attachment id dup'],
      [rawEntry({ id: 'e', attachments: [{ id: 'z', name: ' x.png', mimeType: 'image/png', base64: btoa('x') }] }), 'has an attachment with an invalid name'],
      [rawEntry({ id: 'e', screenshot: { mimeType: 'image/png' } }), 'has an invalid screenshot'],
      ['not an object' as unknown as Record<string, unknown>, 'is not an annotation object'],
    ];
    for (const [entry, reason] of cases) {
      await expect(importJson(JSON.stringify([valid, entry]), new MemoryBlobStore(), dimensions)).resolves.toBe(
        `Import failed: entry 2 ${reason}. Nothing was imported.`,
      );
    }
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('reports an undecodable screenshot in plain words instead of the engine message', async () => {
    const json = JSON.stringify([rawEntry({ screenshot: { mimeType: 'image/png', base64: btoa('not an image') } })]);
    const status = await importJson(json, new MemoryBlobStore(), async () => { throw new Error('The source image could not be decoded.'); });
    expect(status).toBe('Import failed: entry 1 has a screenshot that could not be read. Nothing was imported.');
    await expect(importJson('{', new MemoryBlobStore(), dimensions)).resolves.toBe('Import failed: the file is not valid JSON. Nothing was imported.');
    await expect(importJson('{}', new MemoryBlobStore(), dimensions)).resolves.toBe('Import failed: the file does not contain a list of annotations. Nothing was imported.');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('rolls back every annotation and blob the import wrote when a later write fails', async () => {
    const store = new MemoryBlobStore();
    const shot = { mimeType: 'image/png', base64: btoa('shot') };
    const json = JSON.stringify([
      rawEntry({ id: 'one', screenshot: shot }),
      rawEntry({ id: 'two', pageUrl: secondPage, attachments: [{ id: 'att', name: 'x.png', mimeType: 'image/png', base64: btoa('x') }] }),
      rawEntry({ id: 'three', screenshot: shot }),
    ]);
    store.failPutAt = 3;
    await expect(importJson(json, store, dimensions)).resolves.toBe('Import failed while saving entry 3. Nothing was imported.');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ [`page:${new URL(secondPage).toString()}`]: [], 'page:https://example.com/docs?mode=full': [] });
    expect(store.blobs.size).toBe(0);

    const originalSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    let sets = 0;
    const set = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (items) => {
      sets += 1;
      if (sets === 2) throw new Error('QUOTA_BYTES quota exceeded');
      await originalSet(items);
    });
    try {
      store.failPutAt = 0;
      await expect(importJson(json, store, dimensions)).resolves.toBe('Import failed while saving entry 2. Nothing was imported.');
    } finally {
      set.mockRestore();
    }
    expect(await storedAnnotations()).toEqual([]);
    expect(store.blobs.size).toBe(0);
  });

  it('keeps existing annotations on the page when rolling back an import', async () => {
    const store = new MemoryBlobStore();
    await importJson(JSON.stringify([rawEntry({ id: 'existing' })]), store, dimensions);
    store.failPutAt = store.puts + 1;
    const status = await importJson(JSON.stringify([rawEntry({ id: 'new-one' }), rawEntry({ id: 'new-two', screenshot: { mimeType: 'image/png', base64: btoa('x') } })]), store, dimensions);
    expect(status).toBe('Import failed while saving entry 2. Nothing was imported.');
    expect((await storedAnnotations()).map((entry) => entry.id)).toEqual(['existing']);
  });
});

describe('JSON export', () => {
  function deps(annotations: Annotation[], store: BlobStore) {
    const delivered: string[] = [];
    return {
      delivered,
      dependencies: { collect: async () => annotations, blobStore: store, deliver: async (json: string) => { delivered.push(json); } },
    };
  }

  it('downloads nothing and says so when there are no annotations', async () => {
    const { delivered, dependencies } = deps([], new MemoryBlobStore());
    await expect(exportJson(dependencies)).resolves.toBe('No annotations to export.');
    expect(delivered).toEqual([]);
  });

  it('exports every annotation, leaves out missing blobs, and the export still imports', async () => {
    const store = new MemoryBlobStore();
    await store.put(attachmentKey('present'), new Blob(['p'], { type: 'image/png' }));
    const source = [
      annotation({
        screenshot: { mimeType: 'image/png', width: 1, height: 1, byteLength: 4 },
        attachments: [
          { id: 'present', name: 'p.png', mimeType: 'image/png', byteLength: 1 },
          { id: 'gone', name: 'g.png', mimeType: 'image/png', byteLength: 1 },
        ],
      }),
      annotation({ id: 'annotation-plain', pageUrl: secondPage }),
    ];
    const { delivered, dependencies } = deps(source, store);
    await expect(exportJson(dependencies)).resolves.toBe('Exported 2 annotations; 2 missing files were left out.');
    expect(delivered).toHaveLength(1);

    fakeBrowser.reset();
    await expect(importJson(delivered[0]!, new MemoryBlobStore(), dimensions)).resolves.toBe('Imported 2 annotations, skipped 0 already present.');
    const restored = (await storedAnnotations()).find((entry) => entry.id === source[0]!.id);
    expect(restored?.screenshot).toBeUndefined();
    expect(restored?.attachments).toEqual([{ id: 'present', name: 'p.png', mimeType: 'image/png', byteLength: 1 }]);
  });

  it('reports a clean export and turns any other failure into a status', async () => {
    const { dependencies } = deps([annotation()], new MemoryBlobStore());
    await expect(exportJson(dependencies)).resolves.toBe('Exported 1 annotation.');
    await expect(exportJson({ ...dependencies, deliver: async () => { throw new Error('clipboard denied'); } })).resolves.toBe('Export failed: clipboard denied');
  });
});
