import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { addAnnotation, addAnnotationWithScreenshot } from '../annotation-storage';
import { isElementContext, isSupportedScreenshotMimeType } from '../annotation-messages';
import type { Annotation, AnnotationInput } from '../annotation';
import { createScreenshotStore, type ScreenshotStore } from '../screenshot/store';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export class JsonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonImportError';
  }
}

export interface JsonImportEntry {
  pageUrl: string;
  input: AnnotationInput;
  screenshot?: { mimeType: string; blob: Blob };
}

export type AnnotationAddMessage = {
  type: 'annotation.add';
  pageUrl: string;
  input: AnnotationInput;
};

export type ImageDimensions = (blob: Blob) => Promise<{ width: number; height: number }>;
export type JsonAnnotationWriter = (
  message: AnnotationAddMessage,
  screenshot?: { blob: Blob; dimensions: { width: number; height: number } },
) => Promise<Annotation>;

export async function serialize(
  annotations: Annotation[],
  screenshotStore: ScreenshotStore = createScreenshotStore(),
): Promise<string> {
  const entries = await Promise.all(
    annotations.map(async (annotation) => {
      const entry: Record<string, unknown> = {
        pageUrl: annotation.pageUrl,
        ...annotationInput(annotation),
      };
      if (annotation.screenshot) {
        const blob = await screenshotStore.get(annotation.id);
        if (!blob) throw new JsonImportError(`Screenshot is missing for ${annotation.id}.`);
        entry.screenshot = {
          mimeType: blob.type,
          base64: await blobToBase64(blob),
        };
      }
      return entry;
    }),
  );
  return JSON.stringify(entries);
}

export function parseImport(json: string): JsonImportEntry[] {
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
    if (
      typeof entry.pageUrl !== 'string' ||
      typeof entry.note !== 'string' ||
      typeof entry.selector !== 'string' ||
      !isElementContext(entry.elementContext)
    ) {
      return [];
    }

    const screenshot = parseScreenshot(entry.screenshot);
    const input: AnnotationInput = {
      note: entry.note,
      selector: entry.selector,
      elementContext: entry.elementContext,
      ...(entry.repro === undefined ? {} : { repro: parseRepro(entry.repro) }),
      ...(entry.cssEdits === undefined ? {} : { cssEdits: parseCssEdits(entry.cssEdits) }),
    };
    return [{ pageUrl: entry.pageUrl, input, ...(screenshot ? { screenshot } : {}) }];
  });
}

export async function importAll(
  plan: JsonImportEntry[],
  screenshotStore: ScreenshotStore = createScreenshotStore(),
  dimensions: ImageDimensions = imageDimensions,
  write: JsonAnnotationWriter = createJsonAnnotationWriter(screenshotStore),
): Promise<void> {
  for (const { pageUrl, input, screenshot } of plan) {
    const message: AnnotationAddMessage = { type: 'annotation.add', pageUrl, input };
    if (!screenshot) {
      await write(message);
      continue;
    }

    await write(message, {
      blob: screenshot.blob,
      dimensions: await dimensions(screenshot.blob),
    });
  }
}

export async function collectAllAnnotations(): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored)
    .filter((key) => key.startsWith('page:'))
    .sort()
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : []));
}

function createJsonAnnotationWriter(screenshotStore: ScreenshotStore): JsonAnnotationWriter {
  return async (message, screenshot) => {
    if (!screenshot) return addAnnotation(message.pageUrl, message.input);
    return addAnnotationWithScreenshot(
      message.pageUrl,
      message.input,
      screenshot.blob,
      screenshot.dimensions,
      screenshotStore,
    );
  };
}

function annotationInput(value: Annotation): AnnotationInput {
  return {
    note: value.note,
    selector: value.selector,
    elementContext: value.elementContext,
    ...(value.repro === undefined ? {} : { repro: value.repro }),
    ...(value.cssEdits === undefined ? {} : { cssEdits: value.cssEdits }),
  };
}

function parseScreenshot(value: unknown): { mimeType: string; blob: Blob } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.mimeType !== 'string' || typeof value.base64 !== 'string') {
    throw new JsonImportError('Screenshot must contain a supported mimeType and base64 data.');
  }
  if (!isSupportedScreenshotMimeType(value.mimeType)) {
    throw new JsonImportError(`Unsupported screenshot mime type: ${value.mimeType}.`);
  }

  const blob = base64ToBlob(value.base64, value.mimeType);
  if (blob.size === 0) {
    throw new JsonImportError('Screenshot must not be empty.');
  }
  if (blob.size > MAX_IMPORT_BYTES) {
    throw new JsonImportError('Screenshot exceeds the 2 MB import limit.');
  }
  return { mimeType: value.mimeType, blob };
}

function parseRepro(value: unknown): NonNullable<AnnotationInput['repro']> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.steps) ||
    !value.steps.every((step) => typeof step === 'string') ||
    typeof value.expected !== 'string' ||
    typeof value.actual !== 'string'
  ) {
    throw new JsonImportError('Invalid reproduction data.');
  }
  return { steps: value.steps, expected: value.expected, actual: value.actual };
}

function parseCssEdits(value: unknown): NonNullable<AnnotationInput['cssEdits']> {
  if (
    !Array.isArray(value) ||
    !value.every(
      (edit) =>
        isRecord(edit) && typeof edit.property === 'string' && typeof edit.value === 'string',
    )
  ) {
    throw new JsonImportError('Invalid CSS edits.');
  }
  return value;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new JsonImportError('Screenshot base64 data is invalid.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
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
