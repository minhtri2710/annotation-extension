import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { addAnnotation, addAnnotationWithScreenshot, addAttachment } from '../annotation-storage';
import { isElementContext } from '../annotation-messages';
import type { Annotation, AnnotationInput, AttachmentMetadata } from '../annotation';
import { attachmentKey, createBlobStore, screenshotKey, type BlobStore } from '../blob-store';
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

export interface JsonImportAttachment {
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface JsonImportEntry {
  pageUrl: string;
  input: AnnotationInput;
  screenshot?: { mimeType: string; blob: Blob };
  attachments?: JsonImportAttachment[];
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
  blobStore: BlobStore = createBlobStore(),
): Promise<string> {
  const entries = await Promise.all(
    annotations.map(async (annotation) => {
      const entry: Record<string, unknown> = {
        pageUrl: annotation.pageUrl,
        ...annotationInput(annotation),
      };
      if (annotation.screenshot) {
        const blob = await blobStore.get(screenshotKey(annotation.id));
        if (!blob) throw new JsonImportError(`Screenshot is missing for ${annotation.id}.`);
        entry.screenshot = {
          mimeType: blob.type,
          base64: await blobToBase64(blob),
        };
      }
      if (annotation.attachments) {
        entry.attachments = await Promise.all(annotation.attachments.map(async (attachment) => {
          const blob = await blobStore.get(attachmentKey(attachment.id));
          if (!blob) throw new JsonImportError(`Attachment is missing for ${attachment.id}.`);
          return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            base64: await blobToBase64(blob),
          };
        }));
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
    const attachments = parseAttachments(entry.attachments);
    const input: AnnotationInput = {
      note: entry.note,
      selector: entry.selector,
      elementContext: entry.elementContext,
      ...(entry.status === undefined ? {} : { status: parseStatus(entry.status) }),
      ...(entry.repro === undefined ? {} : { repro: parseRepro(entry.repro) }),
      ...(entry.cssEdits === undefined ? {} : { cssEdits: parseCssEdits(entry.cssEdits) }),
    };
    return [{
      pageUrl: entry.pageUrl,
      input,
      ...(screenshot ? { screenshot } : {}),
      ...(attachments ? { attachments } : {}),
    }];
  });
}

export async function importAll(
  plan: JsonImportEntry[],
  blobStore: BlobStore = createBlobStore(),
  dimensions: ImageDimensions = imageDimensions,
  write: JsonAnnotationWriter = createJsonAnnotationWriter(blobStore),
): Promise<void> {
  for (const { pageUrl, input, screenshot, attachments } of plan) {
    const message: AnnotationAddMessage = { type: 'annotation.add', pageUrl, input };
    let annotation: Annotation;
    if (!screenshot) {
      annotation = await write(message);
    } else {
      annotation = await write(message, {
        blob: screenshot.blob,
        dimensions: await dimensions(screenshot.blob),
      });
    }

    for (const attachment of attachments ?? []) {
      const metadata: AttachmentMetadata = {
        id: crypto.randomUUID(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        byteLength: attachment.blob.size,
      };
      try {
        await addAttachment(pageUrl, annotation.id, metadata, attachment.blob, blobStore);
      } catch (error) {
        throw new JsonImportError(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

export async function collectAllAnnotations(): Promise<Annotation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored)
    .filter((key) => key.startsWith('page:'))
    .sort()
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : []));
}

function createJsonAnnotationWriter(blobStore: BlobStore): JsonAnnotationWriter {
  return async (message, screenshot) => {
    if (!screenshot) return addAnnotation(message.pageUrl, message.input);
    return addAnnotationWithScreenshot(
      message.pageUrl,
      message.input,
      screenshot.blob,
      screenshot.dimensions,
      blobStore,
    );
  };
}

function annotationInput(value: Annotation): AnnotationInput {
  return {
    note: value.note,
    selector: value.selector,
    elementContext: value.elementContext,
    status: value.status,
    ...(value.repro === undefined ? {} : { repro: value.repro }),
    ...(value.cssEdits === undefined ? {} : { cssEdits: value.cssEdits }),
  };
}

function parseScreenshot(value: unknown): { mimeType: string; blob: Blob } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.mimeType !== 'string' || typeof value.base64 !== 'string') {
    throw new JsonImportError('Screenshot must contain a supported mimeType and base64 data.');
  }
  const blob = parseImage(value.base64, value.mimeType, 'Screenshot');
  return { mimeType: value.mimeType, blob };
}

function parseAttachments(value: unknown): JsonImportAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new JsonImportError('Import cannot contain more than 5 attachments.');
  }
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.mimeType !== 'string' || typeof entry.base64 !== 'string') {
      throw new JsonImportError('Attachment must contain name, mimeType and base64 data.');
    }
    let name: string;
    try {
      name = validateAttachmentName(entry.name);
    } catch (error) {
      throw new JsonImportError(error instanceof Error ? error.message : String(error));
    }
    return { name, mimeType: entry.mimeType, blob: parseImage(entry.base64, entry.mimeType, 'Attachment') };
  });
}

function parseImage(base64: string, mimeType: string, label: string): Blob {
  if (!isSupportedImageMimeType(mimeType)) {
    throw new JsonImportError(`Unsupported ${label.toLowerCase()} mime type: ${mimeType}.`);
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new JsonImportError(`${label} base64 data is invalid.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  try {
    validateImageBlob(blob, mimeType);
  } catch (error) {
    throw new JsonImportError(error instanceof Error ? error.message : String(error));
  }
  return blob;
}

function parseStatus(value: unknown): NonNullable<AnnotationInput['status']> {
  if (value !== 'open' && value !== 'resolved') throw new JsonImportError('Status must be open or resolved.');
  return value;
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
        isRecord(edit) &&
        typeof edit.property === 'string' &&
        typeof edit.value === 'string' &&
        typeof edit.original === 'string',
    )
  ) {
    throw new JsonImportError('Invalid CSS edits.');
  }
  return value;
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
