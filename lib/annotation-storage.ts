import { browser } from 'wxt/browser';
import { pageKey } from '../utils/page-key';
import type { Annotation, AnnotationInput, AnnotationUpdate } from './annotation';

const writeQueues = new Map<string, Promise<void>>();

export async function addAnnotation(pageUrl: string, input: AnnotationInput): Promise<Annotation> {
  return withPageWrite(pageUrl, async (key) => {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      pageUrl,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    const annotations = await readPage(key);
    await browser.storage.local.set({ [key]: [...annotations, annotation] });
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
      screenshot: changes.screenshot ?? existing.screenshot,
      createdAt: existing.createdAt,
      updatedAt: nextTimestamp(existing.updatedAt),
    };
    annotations[index] = updated;
    await browser.storage.local.set({ [key]: annotations });
    return updated;
  });
}

export async function deleteAnnotation(pageUrl: string, id: string): Promise<boolean> {
  return withPageWrite(pageUrl, async (key) => {
    const annotations = await readPage(key);
    const remaining = annotations.filter((annotation) => annotation.id !== id);
    if (remaining.length === annotations.length) return false;

    await browser.storage.local.set({ [key]: remaining });
    return true;
  });
}

export async function clearAnnotations(pageUrl: string): Promise<void> {
  return withPageWrite(pageUrl, (key) => browser.storage.local.remove(key));
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
