import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Annotation } from '../annotation';
import { exportJson, importAll, importFileSizeError, importJson, JsonImportError, MAX_IMPORT_LENGTH, parseImport, serialize } from './index';
import { annotationWriteError, MAX_LIST_LENGTH, MAX_TEXT_LENGTH, sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { registerBackgroundMessageHandlers } from '../wiring/background-messages';
import { addAnnotationWithScreenshot, addAttachment } from '../annotation-storage';
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

const SIGNATURES: Record<string, string> = { 'image/png': '\x89PNG\r\n\x1a\n', 'image/jpeg': '\xff\xd8\xff', 'image/webp': 'RIFF\0\0\0\0WEBP' };
/** Base64 of a payload behind the image signature the import checks. */
function image(payload: string, mimeType = 'image/png'): string {
  return btoa(SIGNATURES[mimeType] + payload);
}
function imageBlob(payload: string, mimeType: string): Blob {
  return new Blob([Uint8Array.from(SIGNATURES[mimeType] + payload, (character) => character.charCodeAt(0))], { type: mimeType });
}
/** The payload after the signature, for byte comparisons. */
async function payload(blob: Blob | undefined): Promise<string | undefined> {
  return blob?.slice(SIGNATURES[blob.type]!.length).text();
}

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
    const blob = imageBlob('shot', 'image/webp');
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
    expect(await payload(plan[0]!.blobs[0]![1])).toBe('shot');
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
      screenshot: { mimeType: 'image/png', base64: image('shot') },
    })]), async () => ({ width: 10, height: 10 }));

    await expect(importAll(plan, store)).rejects.toThrow('Import failed while saving entry 1. Nothing was imported.');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('imports non-screenshot entries and screenshot entries with injected dimensions', async () => {
    const store = new MemoryBlobStore();
    const plan = await parseImport(JSON.stringify([rawEntry({
      note: 'With image', selector: '#target',
      screenshot: { mimeType: 'image/png', base64: image('shot') },
    })]), async () => ({ width: 10, height: 20 }));
    await importAll(plan, store);
    const entries = await storedAnnotations();
    expect(entries).toHaveLength(1);
    const imported = entries[0] as Annotation;
    expect(imported.screenshot).toEqual({ mimeType: 'image/png', width: 10, height: 20, byteLength: 12 });
    expect(await store.get(`screenshot:${imported.id}`)).toBeDefined();
  });

  it('round-trips status and attachments through JSON', async () => {
    const store = new MemoryBlobStore();
    const attachmentBlob = imageBlob('attach', 'image/png');
    await store.put('attachment:attachment-1', attachmentBlob);
    const source = annotation({
      status: 'resolved',
      attachments: [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: attachmentBlob.size }],
    });
    const exported = JSON.parse((await serialize([source], store)).json) as [{ status: string; attachments: [{ id: string; name: string; mimeType: string; base64: string }] }];
    expect(exported[0].status).toBe('resolved');
    expect(exported[0].attachments).toEqual([{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', base64: image('attach') }]);
    const plan = await parseImport(JSON.stringify(exported), dimensions);
    expect(plan[0]?.annotation.status).toBe('resolved');
    expect(plan[0]?.annotation.attachments?.[0]?.name).toBe('photo.png');
  });

  it('rejects invalid attachment JSON and preserves Blob-before-metadata ordering', async () => {
    const base = rawEntry();
    await expect(parseImport(JSON.stringify([{ ...base, attachments: [{ id: 'a', name: 'x.png', mimeType: 'image/svg+xml', base64: image('x') }] }]), dimensions)).rejects.toThrow('unsupported attachment type');
    await expect(parseImport(JSON.stringify([{ ...base, attachments: Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, name: 'x.png', mimeType: 'image/png', base64: image('x') })) }]), dimensions)).rejects.toThrow('more than 5');

    const store = new MemoryBlobStore();
    const order: string[] = [];
    const originalPut = store.put.bind(store);
    store.put = async (key, blob) => { order.push(`put:${key}`); await originalPut(key, blob); };
    const plan = await parseImport(JSON.stringify([{ ...base, attachments: [{ id: 'a', name: 'x.png', mimeType: 'image/png', base64: image('x') }] }]), dimensions);
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
    const shot = imageBlob('shot', 'image/png');
    const file = imageBlob('file', 'image/jpeg');
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
    expect(await target.get(screenshotKey(source.id))?.then(payload)).toBe('shot');
    expect(await payload(await target.get(attachmentKey('attachment-keep')))).toBe('file');
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
      [rawEntry({ id: 'e', attachments: [{ name: 'x.png', mimeType: 'image/png', base64: image('x') }] }), 'has an attachment without an id'],
      [rawEntry({ id: 'e', attachments: [{ id: 'dup', name: 'x.png', mimeType: 'image/png', base64: image('x') }, { id: 'dup', name: 'y.png', mimeType: 'image/png', base64: image('y') }] }), 'repeats attachment id dup'],
      [rawEntry({ id: 'e', attachments: [{ id: 'z', name: ' x.png', mimeType: 'image/png', base64: image('x') }] }), 'has an attachment with an invalid name'],
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
    const json = JSON.stringify([rawEntry({ screenshot: { mimeType: 'image/png', base64: image('not an image') } })]);
    const status = await importJson(json, new MemoryBlobStore(), async () => { throw new Error('The source image could not be decoded.'); });
    expect(status).toBe('Import failed: entry 1 has a screenshot that could not be read. Nothing was imported.');
    await expect(importJson('{', new MemoryBlobStore(), dimensions)).resolves.toBe('Import failed: the file is not valid JSON. Nothing was imported.');
    await expect(importJson('{}', new MemoryBlobStore(), dimensions)).resolves.toBe('Import failed: the file does not contain a list of annotations. Nothing was imported.');
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('rolls back every annotation and blob the import wrote when a later write fails', async () => {
    const store = new MemoryBlobStore();
    const shot = { mimeType: 'image/png', base64: image('shot') };
    const json = JSON.stringify([
      rawEntry({ id: 'one', screenshot: shot }),
      rawEntry({ id: 'two', pageUrl: secondPage, attachments: [{ id: 'att', name: 'x.png', mimeType: 'image/png', base64: image('x') }] }),
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
    const status = await importJson(JSON.stringify([rawEntry({ id: 'new-one' }), rawEntry({ id: 'new-two', screenshot: { mimeType: 'image/png', base64: image('x') } })]), store, dimensions);
    expect(status).toBe('Import failed while saving entry 2. Nothing was imported.');
    expect((await storedAnnotations()).map((entry) => entry.id)).toEqual(['existing']);
  });
});

describe('JSON import across pages', () => {
  it('skips an id stored on another page and never touches that annotation or its blob, even on rollback', async () => {
    const store = new MemoryBlobStore();
    const pageA = rawEntry({ id: 'shared', screenshot: { mimeType: 'image/png', base64: image('page-a-bytes') } });
    await expect(importJson(JSON.stringify([pageA]), store, dimensions)).resolves.toBe('Imported 1 annotation, skipped 0 already present.');
    store.failPutAt = store.puts + 2;
    const json = JSON.stringify([
      rawEntry({ id: 'shared', pageUrl: secondPage, screenshot: { mimeType: 'image/png', base64: image('page-b-bytes') } }),
      rawEntry({ id: 'fresh', pageUrl: secondPage, screenshot: { mimeType: 'image/png', base64: image('x') }, attachments: [{ id: 'fresh-att', name: 'x.png', mimeType: 'image/png', base64: image('y') }] }),
    ]);
    await expect(importJson(json, store, dimensions)).resolves.toBe('Import failed while saving entry 2. Nothing was imported.');
    const stored = await storedAnnotations();
    expect(stored.map((entry) => [entry.id, entry.pageUrl])).toEqual([['shared', firstPage]]);
    expect(stored[0]!.screenshot).toBeDefined();
    expect(await payload(await store.get(screenshotKey('shared')))).toBe('page-a-bytes');
    expect([...store.blobs.keys()]).toEqual([screenshotKey('shared')]);
  });

  it('counts an id stored on another page as already present and writes nothing for it', async () => {
    const store = new MemoryBlobStore();
    await importJson(JSON.stringify([rawEntry({ id: 'shared', screenshot: { mimeType: 'image/png', base64: image('a') } })]), store, dimensions);
    const puts = store.puts;
    const json = JSON.stringify([rawEntry({ id: 'shared', pageUrl: secondPage, screenshot: { mimeType: 'image/png', base64: image('b') } }), rawEntry({ id: 'other', pageUrl: secondPage })]);
    await expect(importJson(json, store, dimensions)).resolves.toBe('Imported 1 annotation, skipped 1 already present.');
    expect(store.puts).toBe(puts);
    expect((await storedAnnotations()).map((entry) => [entry.id, entry.pageUrl]).sort()).toEqual([['other', secondPage], ['shared', firstPage]]);
    expect(await payload(await store.get(screenshotKey('shared')))).toBe('a');
  });

  it('rejects a new annotation that reuses a stored attachment id, before any write', async () => {
    const store = new MemoryBlobStore();
    const attachment = (bytes: string) => [{ id: 'att', name: 'x.png', mimeType: 'image/png', base64: image(bytes) }];
    await importJson(JSON.stringify([rawEntry({ id: 'owner', attachments: attachment('mine') })]), store, dimensions);
    const puts = store.puts;
    const json = JSON.stringify([rawEntry({ id: 'first-new', pageUrl: secondPage }), rawEntry({ id: 'intruder', pageUrl: secondPage, attachments: attachment('theirs') })]);
    await expect(importJson(json, store, dimensions)).resolves.toBe('Import failed: entry 2 reuses attachment id att that is already stored. Nothing was imported.');
    expect(store.puts).toBe(puts);
    expect((await storedAnnotations()).map((entry) => entry.id)).toEqual(['owner']);
    expect(await payload(await store.get(attachmentKey('att')))).toBe('mine');
  });
});

describe('JSON export', () => {
  function deps(annotations: Annotation[], store: BlobStore) {
    const delivered: string[] = [];
    return {
      delivered,
      dependencies: {
        collect: async () => annotations,
        blobStore: store,
        download: (json: string) => { delivered.push(json); },
        copy: async (_json: string) => {},
      },
    };
  }

  it('downloads nothing and says so when there are no annotations', async () => {
    const { delivered, dependencies } = deps([], new MemoryBlobStore());
    await expect(exportJson(dependencies)).resolves.toBe('No annotations to export.');
    expect(delivered).toEqual([]);
  });

  it('exports every annotation, leaves out missing blobs, and the export still imports', async () => {
    const store = new MemoryBlobStore();
    await store.put(attachmentKey('present'), imageBlob('p', 'image/png'));
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
    expect(restored?.attachments).toEqual([{ id: 'present', name: 'p.png', mimeType: 'image/png', byteLength: 9 }]);
  });

  it('reports a clean export and turns any other failure into a status', async () => {
    const { dependencies } = deps([annotation()], new MemoryBlobStore());
    await expect(exportJson(dependencies)).resolves.toBe('Exported 1 annotation.');
    await expect(exportJson({ ...dependencies, download: () => { throw new Error('download blocked'); } })).resolves.toBe('Export failed: download blocked');
  });

  it('downloads before copying, and a clipboard failure never prevents the download', async () => {
    const order: string[] = [];
    const { dependencies } = deps([annotation()], new MemoryBlobStore());
    const status = await exportJson({
      ...dependencies,
      download: (json) => { order.push(`download:${JSON.parse(json).length}`); },
      copy: async () => { order.push('copy'); throw new Error('clipboard denied'); },
    });
    expect(order).toEqual(['download:1', 'copy']);
    expect(status).toBe('Exported 1 annotation. Downloaded; copy to clipboard failed: clipboard denied');
  });
});

describe('strict JSON import', () => {
  it('keeps only known fields at every level, so an own __proto__ or constructor key is never stored or exported', async () => {
    const junk = '"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"extra":"x"';
    const context = JSON.stringify(firstElementContext).slice(1, -1)
      .replace('"boundingBox":{', `"boundingBox":{${junk},`)
      .replace('"viewport":{', `"viewport":{${junk},`)
      .replace('"sourcePath":{', `"sourcePath":{${junk},`);
    const json = `[{${junk},"id":"e1","pageUrl":"${firstPage}","note":"n","selector":"#x","status":"open",`
      + `"createdAt":"2024-02-01T10:00:00.000Z","updatedAt":"2024-02-01T10:00:00.000Z",`
      + `"elementContext":{${junk},${context}},`
      + `"repro":{${junk},"steps":["s"],"expected":"e","actual":"a"},`
      + `"cssEdits":[{${junk},"property":"color","value":"red","original":"blue"}],`
      + `"screenshot":{${junk},"mimeType":"image/png","base64":"${image('shot')}"},`
      + `"attachments":[{${junk},"id":"att","name":"x.png","mimeType":"image/png","base64":"${image('x')}"}]}]`;
    expect(JSON.parse(json)[0].elementContext.boundingBox).toHaveProperty('__proto__', { polluted: 'yes' });

    const store = new MemoryBlobStore();
    await expect(importJson(json, store, dimensions)).resolves.toBe('Imported 1 annotation, skipped 0 already present.');
    const [stored] = await storedAnnotations();
    expect(stored).toEqual({
      id: 'e1', pageUrl: firstPage, note: 'n', selector: '#x', status: 'open',
      createdAt: '2024-02-01T10:00:00.000Z', updatedAt: '2024-02-01T10:00:00.000Z',
      elementContext: firstElementContext,
      repro: { steps: ['s'], expected: 'e', actual: 'a' },
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
      screenshot: { mimeType: 'image/png', width: 10, height: 20, byteLength: 12 },
      attachments: [{ id: 'att', name: 'x.png', mimeType: 'image/png', byteLength: 9 }],
    });
    const exported = (await serialize([stored!], store)).json;
    expect(exported).not.toMatch(/__proto__|constructor|extra|polluted/);
    expect(Object.prototype).not.toHaveProperty('polluted');
    for (const record of [stored, stored!.elementContext, stored!.elementContext.boundingBox, stored!.elementContext.viewport, stored!.elementContext.sourcePath, stored!.repro, stored!.cssEdits![0]]) {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect(Object.hasOwn(record!, '__proto__')).toBe(false);
    }
  });

  it('rejects out-of-grammar values with the entry position and reason, and writes nothing', async () => {
    const valid = rawEntry({ id: 'valid' });
    const long = 'x'.repeat(10_001);
    const cases: [Record<string, unknown>, string][] = [
      [rawEntry({ id: 'a'.repeat(65) }), 'has an invalid annotation id'],
      [rawEntry({ id: 'e', attachments: [{ id: 'b'.repeat(65), name: 'x.png', mimeType: 'image/png', base64: image('x') }] }), 'has an attachment with an invalid id'],
      [rawEntry({ id: 'e', pageUrl: 'javascript:alert(1)' }), 'has an invalid page URL'],
      [rawEntry({ id: 'e', pageUrl: 'data:text/html,<p>x</p>' }), 'has an invalid page URL'],
      [rawEntry({ id: 'e', pageUrl: 'about:blank' }), 'has an invalid page URL'],
      [rawEntry({ id: 'e', pageUrl: `https://example.com/${long}` }), 'has an invalid page URL'],
      [rawEntry({ id: 'e', note: ' \n\t ' }), 'has an empty note'],
      [rawEntry({ id: 'e', note: long }), 'has a note longer than 10000 characters'],
      [rawEntry({ id: 'e', selector: long }), 'has a selector longer than 10000 characters'],
      [rawEntry({ id: 'e', elementContext: { ...firstElementContext, text: long } }), 'has invalid element details'],
      [rawEntry({ id: 'e', elementContext: { ...firstElementContext, classList: Array.from({ length: 1001 }, () => 'c') } }), 'has invalid element details'],
      [rawEntry({ id: 'e', repro: { steps: [long], expected: '', actual: '' } }), 'has invalid reproduction steps'],
      [rawEntry({ id: 'e', repro: { steps: Array.from({ length: 1001 }, () => 's'), expected: '', actual: '' } }), 'has invalid reproduction steps'],
      [rawEntry({ id: 'e', cssEdits: [{ property: 'color', value: long, original: '' }] }), 'has invalid CSS edits'],
      [rawEntry({ id: 'e', screenshot: { mimeType: 'image/png', base64: image('x', 'image/jpeg') } }), 'has an invalid screenshot: image bytes are not image/png'],
      [rawEntry({ id: 'e', attachments: [{ id: 'z', name: 'x.png', mimeType: 'image/png', base64: btoa('<svg onload=alert(1)>') }] }), 'has an invalid attachment: image bytes are not image/png'],
      [rawEntry({ id: 'e', attachments: [{ id: 'z', name: 'x.webp', mimeType: 'image/webp', base64: btoa('RIFF\0\0\0\0WAVE') }] }), 'has an invalid attachment: image bytes are not image/webp'],
    ];
    for (const [entry, reason] of cases) {
      await expect(importJson(JSON.stringify([valid, entry]), new MemoryBlobStore(), dimensions), reason).resolves.toBe(
        `Import failed: entry 2 ${reason}. Nothing was imported.`,
      );
    }
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('accepts http, https and file pages and every supported image signature', async () => {
    const json = JSON.stringify([
      rawEntry({ id: 'h', pageUrl: 'http://example.com/', screenshot: { mimeType: 'image/jpeg', base64: image('j', 'image/jpeg') } }),
      rawEntry({ id: 'f', pageUrl: 'file:///tmp/page.html', attachments: [{ id: 'w', name: 'w.webp', mimeType: 'image/webp', base64: image('w', 'image/webp') }] }),
    ]);
    await expect(importJson(json, new MemoryBlobStore(), dimensions)).resolves.toBe('Imported 2 annotations, skipped 0 already present.');
  });

  it('rejects a file over the size cap before parsing it', async () => {
    await expect(importJson(' '.repeat(MAX_IMPORT_LENGTH + 1), new MemoryBlobStore(), dimensions)).resolves.toBe(
      'Import failed: the file is larger than 200 MB. Nothing was imported.',
    );
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });
});

describe('write path and import share one set of caps', () => {
  const at = (length: number) => 'x'.repeat(length);
  const items = (length: number) => Array.from({ length }, () => 's');
  const edits = (length: number) => Array.from({ length }, () => ({ property: 'color', value: 'red', original: 'blue' }));
  const pageAt = (length: number) => 'https://example.com/' + 'a'.repeat(length - 'https://example.com/'.length);
  const input = (overrides: Record<string, unknown>) => ({ note: 'n', selector: '#x', elementContext: secondElementContext, ...overrides });
  // Each variant puts one field or list at the given length.
  const variants: [string, (length: number, list: number) => AnnotationWriteMessage][] = [
    ['note', (length) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ note: at(length) }) })],
    ['repro field', (length) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ repro: { steps: [], expected: at(length), actual: '' } }) })],
    ['CSS value', (length) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ cssEdits: [{ property: 'color', value: at(length), original: '' }] }) })],
    ['selector', (length) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ selector: at(length), elementContext: { ...secondElementContext, selector: at(length) } }) })],
    ['pageUrl', (length) => ({ type: 'annotation.add', pageUrl: pageAt(length), input: input({ elementContext: { ...secondElementContext, url: pageAt(length) } }) })],
    ['repro steps list', (_, list) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ repro: { steps: items(list), expected: '', actual: '' } }) })],
    ['CSS edits list', (_, list) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ cssEdits: edits(list) }) })],
    ['classList', (_, list) => ({ type: 'annotation.add', pageUrl: secondPage, input: input({ elementContext: { ...secondElementContext, classList: items(list) } }) })],
  ];

  beforeEach(() => registerBackgroundMessageHandlers({ blobStore: new MemoryBlobStore() }));

  it('imports and byte-identically re-exports anything the write path accepts at every cap', async () => {
    for (const [name, variant] of variants) {
      fakeBrowser.reset();
      registerBackgroundMessageHandlers({ blobStore: new MemoryBlobStore() });
      const message = variant(MAX_TEXT_LENGTH, MAX_LIST_LENGTH);
      const written = await sendAnnotationWrite(message);
      const first = await serialize([written as Annotation], new MemoryBlobStore());
      const plan = await parseImport(first.json, dimensions);
      const second = await serialize(plan.map((entry) => entry.annotation), new MemoryBlobStore());
      expect(second.json, name).toBe(first.json);
    }
  });

  it('imports and byte-identically re-exports an annotation whose screenshot and attachments the storage functions wrote', async () => {
    fakeBrowser.reset();
    const store = new MemoryBlobStore();
    const written = await addAnnotationWithScreenshot(firstPage, annotation(), imageBlob('shot', 'image/webp'), { width: 10, height: 20 }, store);
    await addAttachment(firstPage, written.id, { id: 'att-png', name: 'a.png', mimeType: 'image/png', byteLength: imageBlob('a', 'image/png').size }, imageBlob('a', 'image/png'), store);
    // A JPEG saved as .png: the picker stores it as image/jpeg under its own name.
    await addAttachment(firstPage, written.id, { id: 'att-jpeg', name: 'photo.png', mimeType: 'image/jpeg', byteLength: imageBlob('j', 'image/jpeg').size }, imageBlob('j', 'image/jpeg'), store);
    const first = await serialize(await storedAnnotations(), store);
    expect(first.missing).toBe(0);

    fakeBrowser.reset();
    const fresh = new MemoryBlobStore();
    await expect(importJson(first.json, fresh, dimensions)).resolves.toBe('Imported 1 annotation, skipped 0 already present.');
    const second = await serialize(await storedAnnotations(), fresh);
    expect(second.json).toBe(first.json);
  });

  it('refuses one past every cap at the write guard, before import could see it', async () => {
    for (const [name, variant] of variants) {
      const message = variant(MAX_TEXT_LENGTH + 1, MAX_LIST_LENGTH + 1);
      expect(annotationWriteError(message), name).toBeDefined();
      await expect(sendAnnotationWrite(message), name).rejects.toThrow(/longer than|not valid/);
    }
    expect(await storedAnnotations()).toEqual([]);
  });

  it('refuses a file over the size cap by its size, before reading it', () => {
    const file = { size: MAX_IMPORT_LENGTH + 1 } as Blob;
    expect(importFileSizeError(file)).toBe('Import failed: the file is larger than 200 MB. Nothing was imported.');
    expect(importFileSizeError(new Blob(['[]']))).toBeUndefined();
    expect(importFileSizeError({ size: MAX_IMPORT_LENGTH } as Blob)).toBeUndefined();
  });
});
