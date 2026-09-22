import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import {
  isAnnotationWriteMessage,
  sendAnnotationWrite,
  type AnnotationWriteMessage,
} from '../annotation-messages';
import type { Annotation, AnnotationInput } from '../annotation';

export class JsonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonImportError';
  }
}

type AnnotationAddMessage = Extract<AnnotationWriteMessage, { type: 'annotation.add' }>;
type AnnotationWriter = (message: AnnotationAddMessage) => unknown | Promise<unknown>;

export function serialize(annotations: Annotation[]): string {
  return JSON.stringify(annotations.map(annotationToInputEntry));
}

export function parseImport(json: string): { pageUrl: string; input: AnnotationInput }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new JsonImportError('Import must be valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new JsonImportError('Import must be a JSON array.');
  }

  return parsed.flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const message = {
      type: 'annotation.add' as const,
      pageUrl: entry.pageUrl,
      input: entry,
    };
    if (!isAnnotationWriteMessage(message)) return [];

    return [{ pageUrl: message.pageUrl, input: annotationInput(message.input) }];
  });
}

export async function importAll(
  plan: { pageUrl: string; input: AnnotationInput }[],
  write: AnnotationWriter = sendAnnotationWrite,
): Promise<void> {
  for (const { pageUrl, input } of plan) {
    await write({ type: 'annotation.add', pageUrl, input });
  }
}

export async function collectAllAnnotations(): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored)
    .filter((key) => key.startsWith('page:'))
    .sort()
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : []));
}

function annotationToInputEntry(annotation: Annotation): Record<string, unknown> {
  return {
    pageUrl: annotation.pageUrl,
    ...annotationInput(annotation),
  };
}

function annotationInput(value: AnnotationInput): AnnotationInput {
  return {
    note: value.note,
    selector: value.selector,
    elementContext: value.elementContext,
    ...(value.screenshot === undefined ? {} : { screenshot: value.screenshot }),
    ...(value.repro === undefined ? {} : { repro: value.repro }),
    ...(value.cssEdits === undefined ? {} : { cssEdits: value.cssEdits }),
  };
}
