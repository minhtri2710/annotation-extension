import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { deleteAnnotation, restoreAnnotation } from '../annotation-storage';
import { isAnnotationStatus, isCssEdits, isElementContext, isRepro } from '../annotation-messages';
import type { Annotation, AttachmentMetadata } from '../annotation';
import { attachmentKey, createBlobStore, screenshotKey, type BlobStore } from '../blob-store';
import { pageKey } from '../../utils/page-key';
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
  deliver(json: string): Promise<void>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function serialize(
  annotations: Annotation[],
  blobStore: BlobStore = createBlobStore(),
): Promise<{ json: string; missing: number }> {
  let missing = 0;
  const entries = [];
  for (const annotation of annotations) {
    const { screenshot, attachments, ...fields } = annotation;
    const entry: Record<string, unknown> = { ...fields };
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
export async function exportJson({ collect, blobStore, deliver }: JsonExportDependencies): Promise<string> {
  try {
    const annotations = await collect();
    if (annotations.length === 0) return 'No annotations to export.';
    const { json, missing } = await serialize(annotations, blobStore);
    await deliver(json);
    const summary = `Exported ${plural(annotations.length, 'annotation')}`;
    return missing > 0 ? `${summary}; ${plural(missing, 'missing file')} ${missing === 1 ? 'was' : 'were'} left out.` : `${summary}.`;
  } catch (error) {
    return `Export failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Validates every entry before returning; any invalid entry rejects the whole file. */
export async function parseImport(
  json: string,
  dimensions: ImageDimensions = imageDimensions,
): Promise<JsonImportEntry[]> {
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
  const written: Annotation[] = [];
  let skipped = 0;
  for (const [index, { annotation, blobs }] of plan.entries()) {
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
  if (typeof entry.selector !== 'string') fail('has no selector');
  if (!isElementContext(entry.elementContext)) fail('has invalid element details');
  if (!isAnnotationStatus(entry.status)) fail('has an invalid status');
  if (!isTimestamp(entry.createdAt)) fail('has an invalid creation date');
  if (!isTimestamp(entry.updatedAt)) fail('has an invalid update date');
  if (entry.repro !== undefined && !isRepro(entry.repro)) fail('has invalid reproduction steps');
  if (entry.cssEdits !== undefined && !isCssEdits(entry.cssEdits)) fail('has invalid CSS edits');

  const annotation = {
    id,
    pageUrl: entry.pageUrl,
    note: entry.note,
    selector: entry.selector,
    elementContext: entry.elementContext,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    status: entry.status,
    ...(entry.repro === undefined ? {} : { repro: entry.repro }),
    ...(entry.cssEdits === undefined ? {} : { cssEdits: entry.cssEdits }),
  } as Annotation;
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
  const blob = new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: value.mimeType });
  try {
    validateImageBlob(blob, value.mimeType);
  } catch (error) {
    fail(`has an invalid ${label}: ${error instanceof Error ? lowerFirst(error.message.replace(/\.$/, '')) : 'unreadable'}`);
  }
  return blob;
}

function isPageUrl(value: string): boolean {
  try {
    pageKey(value);
    return true;
  } catch {
    return false;
  }
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
