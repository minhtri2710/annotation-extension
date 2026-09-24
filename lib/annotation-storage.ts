import { browser } from 'wxt/browser';
import { PAGE_KEY_PREFIX, pageKey } from '../utils/page-key';
import { attachmentKey, screenshotKey, type BlobStore } from './blob-store';
import { MAX_ATTACHMENTS, validateAttachmentName, validateImageBlob } from './attachments/validation';
import type {
  Annotation,
  AnnotationInput,
  AnnotationUpdate,
  AttachmentMetadata,
  ScreenshotMetadata,
} from './annotation';

const writeQueues = new Map<string, Promise<void>>();

export async function listAllAnnotations(): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored)
    .filter((key) => key.startsWith(PAGE_KEY_PREFIX))
    .sort()
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : []));
}

export async function addAnnotation(pageUrl: string, input: AnnotationInput): Promise<Annotation> {
  return withPageWrite(pageUrl, async (key) => {
    const annotation = createAnnotation(pageUrl, input);
    const annotations = await readPage(key);
    await browser.storage.local.set({ [key]: [...annotations, annotation] });
    return annotation;
  });
}

/** Stores an annotation exactly as given; returns false, writing nothing, when its id is already on the page. */
export async function restoreAnnotation(
  annotation: Annotation,
  blobs: ReadonlyArray<readonly [string, Blob]>,
  blobStore: BlobStore,
): Promise<boolean> {
  for (const [, blob] of blobs) await validateImageBlob(blob);
  return withPageWrite(annotation.pageUrl, async (key) => {
    const annotations = await readPage(key);
    if (annotations.some((existing) => existing.id === annotation.id)) return false;
    try {
      for (const [blobKey, blob] of blobs) await blobStore.put(blobKey, blob);
      await browser.storage.local.set({ [key]: [...annotations, annotation] });
    } catch (error) {
      await blobStore.delete(blobs.map(([blobKey]) => blobKey));
      throw error;
    }
    return true;
  });
}

export async function listAnnotations(pageUrl: string): Promise<Annotation[]> {
  return readPage(pageKey(pageUrl));
}

export async function updateAnnotation(
  pageUrl: string,
  id: string,
  changes: AnnotationUpdate,
): Promise<Annotation | null> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const index = annotations.findIndex((annotation) => annotation.id === id);
    if (index === -1) return null;

    const existing = annotations[index];
    if (!existing) return null;

    const updated: Annotation = {
      id: existing.id,
      pageUrl: existing.pageUrl,
      note: changes.note ?? existing.note,
      selector: changes.selector ?? existing.selector,
      elementContext: changes.elementContext ?? existing.elementContext,
      screenshot: existing.screenshot,
      ...(existing.attachments === undefined ? {} : { attachments: existing.attachments }),
      status: changes.status ?? existing.status,
      repro: changes.repro ?? existing.repro,
      cssEdits: changes.cssEdits ?? existing.cssEdits,
      createdAt: existing.createdAt,
      updatedAt: nextTimestamp(existing.updatedAt),
    };
    annotations[index] = updated;
    await browser.storage.local.set({ [key]: annotations });
    return updated;
  });
}

export async function updateAnnotationScreenshot(
  pageUrl: string,
  id: string,
  screenshot: ScreenshotMetadata,
): Promise<Annotation | null> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const index = annotations.findIndex((annotation) => annotation.id === id);
    if (index === -1) return null;

    const existing = annotations[index];
    if (!existing) return null;
    const updated: Annotation = {
      ...existing,
      screenshot,
      updatedAt: nextTimestamp(existing.updatedAt),
    };
    const updatedAnnotations = annotations.map((annotation, annotationIndex) =>
      annotationIndex === index ? updated : annotation,
    );
    await browser.storage.local.set({ [key]: updatedAnnotations });
    return updated;
  });
}

export async function addAttachment(
  pageUrl: string,
  annotationId: string,
  metadata: AttachmentMetadata,
  blob: Blob,
  blobStore: BlobStore,
): Promise<AttachmentMetadata> {
  validateAttachmentName(metadata.name);
  await validateImageBlob(blob, metadata.mimeType);
  if (metadata.byteLength !== blob.size) throw new Error('Attachment byte length does not match its Blob.');
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const index = annotations.findIndex((annotation) => annotation.id === annotationId);
    if (index === -1) throw new Error('Annotation was not found');
    const existing = annotations[index];
    if (!existing) throw new Error('Annotation was not found');
    if ((existing.attachments?.length ?? 0) >= MAX_ATTACHMENTS) {
      throw new Error(`An annotation can have at most ${MAX_ATTACHMENTS} attachments`);
    }

    const keyForBlob = attachmentKey(metadata.id);
    await blobStore.put(keyForBlob, blob);
    try {
      const attachments = [...(existing.attachments ?? []), metadata];
      const updated: Annotation = {
        ...existing,
        attachments,
        updatedAt: nextTimestamp(existing.updatedAt),
      };
      annotations[index] = updated;
      await browser.storage.local.set({ [key]: annotations });
    } catch (error) {
      await blobStore.delete([keyForBlob]);
      throw error;
    }
    return metadata;
  });
}

export async function deleteAttachment(
  pageUrl: string,
  annotationId: string,
  attachmentId: string,
  blobStore: BlobStore,
): Promise<boolean> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const index = annotations.findIndex((annotation) => annotation.id === annotationId);
    if (index === -1) return false;
    const existing = annotations[index];
    if (!existing || !existing.attachments?.some((attachment) => attachment.id === attachmentId)) return false;

    const attachments = existing.attachments.filter((attachment) => attachment.id !== attachmentId);
    const updated = { ...existing, attachments: attachments.length > 0 ? attachments : undefined, updatedAt: nextTimestamp(existing.updatedAt) };
    annotations[index] = updated;
    await browser.storage.local.set({ [key]: annotations });
    await blobStore.delete([attachmentKey(attachmentId)]);
    return true;
  });
}

export async function deleteAnnotation(
  pageUrl: string,
  id: string,
  blobStore: BlobStore,
): Promise<boolean> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const target = annotations.find((annotation) => annotation.id === id);
    if (!target) return false;

    const remaining = annotations.filter((annotation) => annotation.id !== id);
    await browser.storage.local.set({ [key]: remaining });
    await blobStore.delete([
      screenshotKey(id),
      ...(target.attachments ?? []).map((attachment) => attachmentKey(attachment.id)),
    ]);
    return true;
  });
}

export async function clearAnnotations(
  pageUrl: string,
  blobStore: BlobStore,
): Promise<void> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    await browser.storage.local.remove(key);
    const keys = annotations.flatMap((annotation) => [
      screenshotKey(annotation.id),
      ...(annotation.attachments ?? []).map((attachment) => attachmentKey(attachment.id)),
    ]);
    await blobStore.delete(keys);
  });
}

function createAnnotation(pageUrl: string, input: AnnotationInput): Annotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    pageUrl,
    note: input.note,
    selector: input.selector,
    elementContext: input.elementContext,
    ...(input.repro === undefined ? {} : { repro: input.repro }),
    ...(input.cssEdits === undefined ? {} : { cssEdits: input.cssEdits }),
    status: input.status ?? 'open',
    createdAt: now,
    updatedAt: now,
  };
}

async function readPage(key: string): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(key);
  return Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : [];
}

async function withPageWrite<T>(
  pageUrl: string,
  operation: (key: string) => Promise<T>,
): Promise<T> {
  const key = pageKey(pageUrl);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.then(
    () => operation(key),
    () => operation(key),
  );
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(key, settled);
  void settled.then(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key);
  });
  return current;
}

function nextTimestamp(previous: string): string {
  const previousTime = Date.parse(previous);
  const minimum = Number.isFinite(previousTime) ? previousTime + 1 : 0;
  return new Date(Math.max(Date.now(), minimum)).toISOString();
}
