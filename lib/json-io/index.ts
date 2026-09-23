import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { deleteAnnotation, restoreAnnotation } from '../annotation-storage';
import {
  ID_PATTERN,
  isAnnotationStatus,
  isCssEdits,
  isElementContext,
  isRepro,
  isText,
  MAX_TEXT_LENGTH,
} from '../annotation-messages';
import type { Annotation, AttachmentMetadata } from '../annotation';
import { attachmentKey, createBlobStore, screenshotKey, type BlobStore } from '../blob-store';
import { pageKey } from '../../utils/page-key';
import { clipboardFailure } from '../export/delivery';
import {
  isSupportedImageMimeType,
  MAX_ATTACHMENTS,
  validateAttachmentName,
  validateImageBlob,
} from '../attachments/validation';

export class JsonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonImportError';
  }
}

/** One validated entry: the annotation to store as given, and its blobs keyed for the blob store. */
export interface JsonImportEntry {
  annotation: Annotation;
  blobs: [string, Blob][];
}

export type ImageDimensions = (blob: Blob) => Promise<{ width: number; height: number }>;

export interface JsonExportDependencies {
  collect(): Promise<Annotation[]>;
  blobStore: BlobStore;
  download(json: string): void;
  copy(json: string): Promise<void>;
}

/** In UTF-16 code units of the file text, so a file over it is also over it in bytes. */
export const MAX_IMPORT_LENGTH = 200 * 1024 * 1024;
const TOO_LARGE = 'Import failed: the file is larger than 200 MB. Nothing was imported.';
const PAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export async function serialize(
  annotations: Annotation[],
  blobStore: BlobStore = createBlobStore(),
): Promise<{ json: string; missing: number }> {
  let missing = 0;
  const entries = [];
  for (const annotation of annotations) {
    const { screenshot, attachments } = annotation;
    const entry: Record<string, unknown> = { ...knownFields(annotation) };
    if (screenshot) {
      const blob = await blobStore.get(screenshotKey(annotation.id));
      if (blob) entry.screenshot = { mimeType: blob.type, base64: await blobToBase64(blob) };
      else missing += 1;
    }
    if (attachments) {
      const exported = [];
      for (const attachment of attachments) {
        const blob = await blobStore.get(attachmentKey(attachment.id));
        if (!blob) {
          missing += 1;
          continue;
        }
        exported.push({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, base64: await blobToBase64(blob) });
      }
      if (exported.length > 0) entry.attachments = exported;
    }
    entries.push(entry);
  }
  return { json: JSON.stringify(entries), missing };
}

/** Returns the status message for the popup. */
export async function exportJson({ collect, blobStore, download, copy }: JsonExportDependencies): Promise<string> {
  try {
    const annotations = await collect();
    if (annotations.length === 0) return 'No annotations to export.';
    const { json, missing } = await serialize(annotations, blobStore);
    download(json);
    const copyFailure = await clipboardFailure(() => copy(json));
    const summary = `Exported ${plural(annotations.length, 'annotation')}`;
    const status = missing > 0 ? `${summary}; ${plural(missing, 'missing file')} ${missing === 1 ? 'was' : 'were'} left out.` : `${summary}.`;
    return copyFailure ? `${status} ${copyFailure}` : status;
  } catch (error) {
    return `Export failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Refuses a file over the size cap by its byte size, before it is read into memory. */
export function importFileSizeError(file: Blob): string | undefined {
  return file.size > MAX_IMPORT_LENGTH ? TOO_LARGE : undefined;
}

/** Validates every entry before returning; any invalid entry rejects the whole file. */
export async function parseImport(
  json: string,
  dimensions: ImageDimensions = imageDimensions,
): Promise<JsonImportEntry[]> {
  if (json.length > MAX_IMPORT_LENGTH) throw new JsonImportError(TOO_LARGE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new JsonImportError('Import failed: the file is not valid JSON. Nothing was imported.');
  }
  if (!Array.isArray(parsed)) {
    throw new JsonImportError('Import failed: the file does not contain a list of annotations. Nothing was imported.');
  }

  const annotationIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const plan: JsonImportEntry[] = [];
  for (const [index, value] of parsed.entries()) {
    const fail = (reason: string): never => {
      throw new JsonImportError(`Import failed: entry ${index + 1} ${reason}. Nothing was imported.`);
    };
    plan.push(await parseEntry(value, fail, annotationIds, attachmentIds, dimensions));
  }
  return plan;
}

export async function importAll(
  plan: JsonImportEntry[],
  blobStore: BlobStore = createBlobStore(),
): Promise<{ imported: number; skipped: number }> {
  // Ids are global and so are blob keys: skip any id stored on any page, and refuse to write over a stored attachment.
  const stored = await collectAllAnnotations();
  const storedIds = new Set(stored.map((annotation) => annotation.id));
  const storedAttachmentIds = new Set(stored.flatMap((annotation) => (annotation.attachments ?? []).map((attachment) => attachment.id)));
  for (const [index, { annotation }] of plan.entries()) {
    if (storedIds.has(annotation.id)) continue;
    const reused = annotation.attachments?.find((attachment) => storedAttachmentIds.has(attachment.id));
    if (reused) {
      throw new JsonImportError(`Import failed: entry ${index + 1} reuses attachment id ${reused.id} that is already stored. Nothing was imported.`);
    }
  }

  const written: Annotation[] = [];
  let skipped = 0;
  for (const [index, { annotation, blobs }] of plan.entries()) {
    if (storedIds.has(annotation.id)) {
      skipped += 1;
      continue;
    }
    try {
      if (await restoreAnnotation(annotation, blobs, blobStore)) written.push(annotation);
      else skipped += 1;
    } catch {
      const rollback = await Promise.allSettled(
        written.map((entry) => deleteAnnotation(entry.pageUrl, entry.id, blobStore)),
      );
      if (rollback.some((result) => result.status === 'rejected')) {
        throw new JsonImportError(`Import failed while saving entry ${index + 1}, and some earlier entries could not be removed.`);
      }
      throw new JsonImportError(`Import failed while saving entry ${index + 1}. Nothing was imported.`);
    }
  }
  return { imported: written.length, skipped };
}

/** Returns the status message for the popup. */
export async function importJson(
  json: string,
  blobStore: BlobStore = createBlobStore(),
  dimensions: ImageDimensions = imageDimensions,
): Promise<string> {
  try {
    const { imported, skipped } = await importAll(await parseImport(json, dimensions), blobStore);
    return `Imported ${plural(imported, 'annotation')}, skipped ${skipped} already present.`;
  } catch (error) {
    return error instanceof JsonImportError ? error.message : 'Import failed. Nothing was imported.';
  }
}

export async function collectAllAnnotations(): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored)
    .filter((key) => key.startsWith('page:'))
    .sort()
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : []));
}

async function parseEntry(
  entry: unknown,
  fail: (reason: string) => never,
  annotationIds: Set<string>,
  attachmentIds: Set<string>,
  dimensions: ImageDimensions,
): Promise<JsonImportEntry> {
  if (!isRecord(entry)) return fail('is not an annotation object');
  if (entry.id === undefined) fail('has no annotation id');
  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) fail('has an invalid annotation id');
  const id = entry.id as string;
  if (annotationIds.has(id)) fail(`repeats annotation id ${id}`);
  annotationIds.add(id);
  if (typeof entry.pageUrl !== 'string' || !isPageUrl(entry.pageUrl)) fail('has an invalid page URL');
  if (typeof entry.note !== 'string') fail('has no note');
  const note = entry.note as string;
  if (!note.trim()) fail('has an empty note');
  if (!isText(note)) fail(`has a note longer than ${MAX_TEXT_LENGTH} characters`);
  if (typeof entry.selector !== 'string') fail('has no selector');
  const selector = entry.selector as string;
  if (!isText(selector)) fail(`has a selector longer than ${MAX_TEXT_LENGTH} characters`);
  const elementContext = isElementContext(entry.elementContext) ? entry.elementContext : fail('has invalid element details');
  if (!isAnnotationStatus(entry.status)) fail('has an invalid status');
  if (!isTimestamp(entry.createdAt)) fail('has an invalid creation date');
  if (!isTimestamp(entry.updatedAt)) fail('has an invalid update date');
  const repro = entry.repro === undefined || isRepro(entry.repro) ? entry.repro : fail('has invalid reproduction steps');
  const cssEdits = entry.cssEdits === undefined || isCssEdits(entry.cssEdits) ? entry.cssEdits : fail('has invalid CSS edits');

  // Rebuilt from known fields only: unknown keys, including an own `__proto__`, are never stored or re-exported.
  const annotation: Annotation = knownFields({
    id,
    pageUrl: entry.pageUrl as string,
    note,
    selector,
    elementContext,
    createdAt: entry.createdAt as string,
    updatedAt: entry.updatedAt as string,
    status: entry.status as Annotation['status'],
    ...(repro === undefined ? {} : { repro }),
    ...(cssEdits === undefined ? {} : { cssEdits }),
  });
  const blobs: [string, Blob][] = [];

  if (entry.screenshot !== undefined) {
    const blob = parseImage(entry.screenshot, 'screenshot', fail);
    let size: { width: number; height: number };
    try {
      size = await dimensions(blob);
    } catch {
      return fail('has a screenshot that could not be read');
    }
    if (!(size.width > 0 && size.height > 0)) fail('has a screenshot that could not be read');
    annotation.screenshot = { mimeType: blob.type, width: size.width, height: size.height, byteLength: blob.size };
    blobs.push([screenshotKey(id), blob]);
  }

  if (entry.attachments !== undefined) {
    if (!Array.isArray(entry.attachments)) fail('has invalid attachments');
    const attachments = entry.attachments as unknown[];
    if (attachments.length > MAX_ATTACHMENTS) fail(`has more than ${MAX_ATTACHMENTS} attachments`);
    const metadata: AttachmentMetadata[] = [];
    for (const attachment of attachments) {
      if (!isRecord(attachment) || attachment.id === undefined) fail('has an attachment without an id');
      const record = attachment as Record<string, unknown>;
      if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) fail('has an attachment with an invalid id');
      const attachmentId = record.id as string;
      if (attachmentIds.has(attachmentId)) fail(`repeats attachment id ${attachmentId}`);
      attachmentIds.add(attachmentId);
      if (typeof record.name !== 'string') fail('has an attachment with an invalid name');
      try {
        validateAttachmentName(record.name as string);
      } catch {
        fail('has an attachment with an invalid name');
      }
      const blob = parseImage(record, 'attachment', fail);
      metadata.push({ id: attachmentId, name: record.name as string, mimeType: blob.type, byteLength: blob.size });
      blobs.push([attachmentKey(attachmentId), blob]);
    }
    if (metadata.length > 0) annotation.attachments = metadata;
  }

  return { annotation, blobs };
}

function parseImage(value: unknown, label: 'screenshot' | 'attachment', fail: (reason: string) => never): Blob {
  if (!isRecord(value) || typeof value.mimeType !== 'string' || typeof value.base64 !== 'string') {
    return fail(`has an invalid ${label}`);
  }
  if (!isSupportedImageMimeType(value.mimeType)) fail(`has an unsupported ${label} type (${value.mimeType})`);
  let binary = '';
  try {
    binary = atob(value.base64);
  } catch {
    fail(`has ${label} data that is not valid base64`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: value.mimeType });
  try {
    validateImageBlob(blob, value.mimeType);
  } catch (error) {
    fail(`has an invalid ${label}: ${error instanceof Error ? lowerFirst(error.message.replace(/\.$/, '')) : 'unreadable'}`);
  }
  if (!hasImageSignature(bytes, value.mimeType)) fail(`has an invalid ${label}: its bytes are not ${value.mimeType}`);
  return blob;
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (signature: string, offset = 0) =>
    [...signature].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  switch (mimeType) {
    case 'image/png': return startsWith('\x89PNG\r\n\x1a\n');
    case 'image/jpeg': return startsWith('\xff\xd8\xff');
    case 'image/webp': return startsWith('RIFF') && startsWith('WEBP', 8);
    default: return false;
  }
}

function isPageUrl(value: string): boolean {
  if (!isText(value)) return false;
  try {
    pageKey(value);
    return PAGE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * A copy of the annotation's text fields from known keys only, in one key order, so export, import and re-export agree
 * byte for byte whichever writer stored the annotation. The caller has already checked every field.
 */
function knownFields(annotation: Annotation): Annotation {
  const { elementContext: context, repro, cssEdits } = annotation;
  const { boundingBox, viewport, sourcePath } = context;
  return {
    id: annotation.id,
    pageUrl: annotation.pageUrl,
    note: annotation.note,
    selector: annotation.selector,
    elementContext: {
      selector: context.selector,
      tagName: context.tagName,
      id: context.id,
      classList: [...context.classList],
      text: context.text,
      boundingBox: { x: boundingBox.x, y: boundingBox.y, width: boundingBox.width, height: boundingBox.height },
      url: context.url,
      viewport: { width: viewport.width, height: viewport.height },
      sourcePath: sourcePath === null
        ? null
        : { fileName: sourcePath.fileName, ...(sourcePath.lineNumber === undefined ? {} : { lineNumber: sourcePath.lineNumber }) },
    },
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
    status: annotation.status,
    ...(repro === undefined ? {} : { repro: { steps: [...repro.steps], expected: repro.expected, actual: repro.actual } }),
    ...(cssEdits === undefined
      ? {}
      : { cssEdits: cssEdits.map(({ property, value, original }) => ({ property, value, original })) }),
  };
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const imageDimensions: ImageDimensions = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};
