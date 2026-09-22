import { browser } from 'wxt/browser';
import { pageKey } from '../utils/page-key';
import type { ScreenshotStore } from './screenshot/store';
import type { Annotation, AnnotationInput, AnnotationUpdate, ScreenshotMetadata } from './annotation';

const writeQueues = new Map<string, Promise<void>>();

export async function addAnnotation(pageUrl: string, input: AnnotationInput): Promise<Annotation> {
  return withPageWrite(pageUrl, async (key) => {
    const annotation = createAnnotation(pageUrl, input);
    const annotations = await readPage(key);
    await browser.storage.local.set({ [key]: [...annotations, annotation] });
    return annotation;
  });
}

export async function addAnnotationWithScreenshot(
  pageUrl: string,
  input: AnnotationInput,
  blob: Blob,
  dimensions: Pick<ScreenshotMetadata, 'width' | 'height'>,
  screenshotStore: ScreenshotStore,
): Promise<Annotation> {
  return withPageWrite(pageUrl, async (key) => {
    const annotation = {
      ...createAnnotation(pageUrl, input),
      screenshot: screenshotMetadata(blob, dimensions),
    };
    const annotations = await readPage(key);
    await screenshotStore.put(annotation.id, blob);
    try {
      await browser.storage.local.set({ [key]: [...annotations, annotation] });
    } catch (error) {
      await screenshotStore.delete([annotation.id]);
      throw error;
    }
    return annotation;
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
    annotations[index] = updated;
    await browser.storage.local.set({ [key]: annotations });
    return updated;
  });
}

export async function deleteAnnotation(
  pageUrl: string,
  id: string,
  screenshotStore: ScreenshotStore,
): Promise<boolean> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const remaining = annotations.filter((annotation) => annotation.id !== id);
    if (remaining.length === annotations.length) return false;

    await browser.storage.local.set({ [key]: remaining });
    await screenshotStore.delete([id]);
    return true;
  });
}

export async function clearAnnotations(
  pageUrl: string,
  screenshotStore: ScreenshotStore,
): Promise<void> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    await browser.storage.local.remove(key);
    await screenshotStore.delete(annotations.map((annotation) => annotation.id));
  });
}

function createAnnotation(pageUrl: string, input: AnnotationInput): Annotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    pageUrl,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
}

function screenshotMetadata(
  blob: Blob,
  dimensions: Pick<ScreenshotMetadata, 'width' | 'height'>,
): ScreenshotMetadata {
  return {
    mimeType: blob.type,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: blob.size,
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
