import { browser } from 'wxt/browser';
import { isRecord } from './guards';
import type { ElementContext } from './capture/context';
import type {
  Annotation,
  AnnotationInput,
  AnnotationStatus,
  AnnotationUpdate,
  AttachmentMetadata,
  CssEdit,
  Repro,
  ScreenshotMetadata,
} from './annotation';
import {
  isSupportedImageMimeType,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  validateAttachmentName,
} from './attachments/validation';

export type AnnotationWriteMessage =
  | { type: 'annotation.add'; pageUrl: string; input: AnnotationInput }
  | { type: 'annotation.update'; pageUrl: string; id: string; changes: AnnotationUpdate }
  | { type: 'annotation.delete'; pageUrl: string; id: string }
  | { type: 'annotation.clear'; pageUrl: string };

export type AnnotationErrorResponse = { ok: false; error: string };

export type AnnotationWriteResponse<T extends AnnotationWriteMessage> = T extends {
  type: 'annotation.add';
}
  ? Annotation
  : T extends { type: 'annotation.update' }
    ? Annotation | null
    : T extends { type: 'annotation.delete' }
      ? boolean
      : void;

export function isAnnotationErrorResponse(value: unknown): value is AnnotationErrorResponse {
  return isRecord(value) && value.ok === false && typeof value.error === 'string';
}

export function createAnnotationErrorResponse(error: unknown): AnnotationErrorResponse {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function isAnnotationWriteMessage(value: unknown): value is AnnotationWriteMessage {
  if (!isRecord(value) || typeof value.pageUrl !== 'string' || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'annotation.add':
      return isAnnotationInput(value.input);
    case 'annotation.update':
      return typeof value.id === 'string' && isAnnotationUpdate(value.changes);
    case 'annotation.delete':
      return typeof value.id === 'string';
    case 'annotation.clear':
      return true;
    default:
      return false;
  }
}

export function sendAnnotationWrite<T extends AnnotationWriteMessage>(
  message: T,
): Promise<AnnotationWriteResponse<T>> {
  return browser.runtime
    .sendMessage<AnnotationWriteMessage, AnnotationWriteResponse<T> | AnnotationErrorResponse>(message)
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      return response;
    });
}

export function isCssEdit(value: unknown): value is CssEdit {
  return isRecord(value) && typeof value.property === 'string' &&
    typeof value.value === 'string' &&
    typeof value.original === 'string';
}

export function isCssEdits(value: unknown): value is CssEdit[] {
  return Array.isArray(value) && value.every(isCssEdit);
}

export function isAnnotationStatus(value: unknown): value is AnnotationStatus {
  return value === 'open' || value === 'resolved';
}

function isAnnotationInput(value: unknown): value is AnnotationInput {
  return (
    isRecord(value) &&
    typeof value.note === 'string' &&
    typeof value.selector === 'string' &&
    isElementContext(value.elementContext) &&
    !('screenshot' in value) &&
    !('attachments' in value) &&
    (value.status === undefined || isAnnotationStatus(value.status)) &&
    (value.repro === undefined || isRepro(value.repro)) &&
    (value.cssEdits === undefined || isCssEdits(value.cssEdits))
  );
}

function isAnnotationUpdate(value: unknown): value is AnnotationUpdate {
  if (!isRecord(value)) return false;
  return (
    (value.note === undefined || typeof value.note === 'string') &&
    (value.selector === undefined || typeof value.selector === 'string') &&
    (value.elementContext === undefined || isElementContext(value.elementContext)) &&
    !('screenshot' in value) &&
    !('attachments' in value) &&
    (value.status === undefined || isAnnotationStatus(value.status)) &&
    (value.repro === undefined || isRepro(value.repro)) &&
    (value.cssEdits === undefined || isCssEdits(value.cssEdits))
  );
}

export function isRepro(value: unknown): value is Repro {
  return (
    isRecord(value) &&
    Array.isArray(value.steps) &&
    value.steps.every((step) => typeof step === 'string') &&
    typeof value.expected === 'string' &&
    typeof value.actual === 'string'
  );
}

export function isScreenshotMetadata(value: unknown): value is ScreenshotMetadata {
  return (
    isRecord(value) &&
    typeof value.mimeType === 'string' &&
    isSupportedImageMimeType(value.mimeType) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isFiniteNumber(value.byteLength) &&
    value.byteLength > 0 &&
    value.byteLength <= MAX_IMAGE_BYTES
  );
}

export function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    !isSupportedImageMimeType(value.mimeType) ||
    !isFiniteNumber(value.byteLength) ||
    value.byteLength <= 0 ||
    value.byteLength > MAX_IMAGE_BYTES
  ) {
    return false;
  }
  try {
    validateAttachmentName(value.name);
  } catch {
    return false;
  }
  return value.name.length <= MAX_ATTACHMENT_NAME_LENGTH;
}

export function isAttachmentMetadataList(value: unknown): value is AttachmentMetadata[] {
  return Array.isArray(value) && value.length <= MAX_ATTACHMENTS && value.every(isAttachmentMetadata);
}

export function isElementContext(value: unknown): value is ElementContext {
  if (!isRecord(value)) return false;
  const boundingBox = value.boundingBox;
  const viewport = value.viewport;
  if (
    !isRecord(boundingBox) ||
    !isRecord(viewport) ||
    typeof value.selector !== 'string' ||
    typeof value.tagName !== 'string' ||
    typeof value.id !== 'string' ||
    !isStringArray(value.classList) ||
    typeof value.text !== 'string' ||
    !isFiniteNumber(boundingBox.x) ||
    !isFiniteNumber(boundingBox.y) ||
    !isFiniteNumber(boundingBox.width) ||
    !isFiniteNumber(boundingBox.height) ||
    typeof value.url !== 'string' ||
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height)
  ) {
    return false;
  }

  return value.sourcePath === null || isSourcePath(value.sourcePath);
}

function isSourcePath(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    (value.lineNumber === undefined || isFiniteNumber(value.lineNumber))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
