import { browser } from 'wxt/browser';
import { errorMessage, isFiniteNumber, isRecord } from './guards';
import { pageKey } from '../utils/page-key';
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

/** Sends a message to the background; an error response throws its text and a malformed response throws invalidError. */
export async function sendBackgroundRequest<M, R>(
  message: M,
  isResponse: (value: unknown) => value is R,
  invalidError: string,
): Promise<R> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (isAnnotationErrorResponse(response)) throw new Error(response.error);
  if (!isResponse(response)) throw new Error(invalidError);
  return response;
}

export function createAnnotationErrorResponse(error: unknown): AnnotationErrorResponse {
  return { ok: false, error: errorMessage(error) };
}

// One definition for the write guards and the JSON import: ids fit the minted UUIDs with room to spare; any other text field and any list is bounded.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** In UTF-16 code units. */
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_LIST_LENGTH = 1_000;
const LIMITS = `each text is at most ${MAX_TEXT_LENGTH} characters and each list at most ${MAX_LIST_LENGTH} items`;
const INVALID_CHANGE = 'The annotation change is not valid.';
const PAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

/** A page the storage can key: an http, https or file URL within the text cap. */
export function isPageUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    pageKey(value);
    return PAGE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isBlankNote(value: string): boolean {
  return !value.trim();
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isText);
}

export function isAnnotationWriteMessage(value: unknown): value is AnnotationWriteMessage {
  return annotationWriteError(value) === undefined;
}

export function isAnnotationWriteType(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' &&
    ['annotation.add', 'annotation.update', 'annotation.delete', 'annotation.clear'].includes(value.type);
}

/** Why a write message is refused, in words for the user; undefined when it is valid. */
export function annotationWriteError(value: unknown): string | undefined {
  if (!isRecord(value) || !isAnnotationWriteType(value)) return INVALID_CHANGE;
  const pageUrlError = textError(value.pageUrl, 'The page URL') ??
    (isPageUrl(value.pageUrl) ? undefined : 'The page URL is not an http, https or file URL.');
  if (pageUrlError) return pageUrlError;

  switch (value.type) {
    case 'annotation.add':
      return annotationFieldsError(value.input, true);
    case 'annotation.update':
      return idError(value.id) ?? annotationFieldsError(value.changes, false);
    case 'annotation.delete':
      return idError(value.id);
    default:
      return undefined;
  }
}

function textError(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string') return `${label} is missing.`;
  return value.length > MAX_TEXT_LENGTH ? `${label} is longer than ${MAX_TEXT_LENGTH} characters.` : undefined;
}

function idError(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? undefined : 'The annotation id is not valid.';
}

// An add requires note, selector and element details; an update may leave any field out.
function annotationFieldsError(value: unknown, required: boolean): string | undefined {
  if (!isRecord(value) || 'screenshot' in value || 'attachments' in value) return INVALID_CHANGE;
  if (value.status !== undefined && !isAnnotationStatus(value.status)) return INVALID_CHANGE;
  const check = (field: unknown, error: () => string | undefined) =>
    field === undefined && !required ? undefined : error();
  const shape = (field: unknown, valid: (field: unknown) => boolean, label: string) =>
    field === undefined || valid(field) ? undefined : `${label} are not valid: ${LIMITS}.`;
  return (
    check(value.note, () => textError(value.note, 'The note') ?? (isBlankNote(value.note as string) ? 'The note is empty.' : undefined)) ??
    check(value.selector, () => textError(value.selector, 'The selector')) ??
    check(value.elementContext, () => isElementContext(value.elementContext) ? undefined : `The element details are not valid: ${LIMITS}.`) ??
    shape(value.repro, isRepro, 'The reproduction steps') ??
    shape(value.cssEdits, isCssEdits, 'The CSS edits')
  );
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
  return isRecord(value) && isText(value.property) && isText(value.value) && isText(value.original);
}

export function isCssEdits(value: unknown): value is CssEdit[] {
  return Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isCssEdit);
}

export function isAnnotationStatus(value: unknown): value is AnnotationStatus {
  return value === 'open' || value === 'resolved';
}

export function isRepro(value: unknown): value is Repro {
  return (
    isRecord(value) &&
    isTextList(value.steps) &&
    isText(value.expected) &&
    isText(value.actual)
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

export function isElementContext(value: unknown): value is ElementContext {
  if (!isRecord(value)) return false;
  const boundingBox = value.boundingBox;
  const viewport = value.viewport;
  if (
    !isRecord(boundingBox) ||
    !isRecord(viewport) ||
    !isText(value.selector) ||
    !isText(value.tagName) ||
    !isText(value.id) ||
    !isTextList(value.classList) ||
    !isText(value.text) ||
    !isFiniteNumber(boundingBox.x) ||
    !isFiniteNumber(boundingBox.y) ||
    !isFiniteNumber(boundingBox.width) ||
    !isFiniteNumber(boundingBox.height) ||
    !isText(value.url) ||
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
    isText(value.fileName) &&
    value.fileName.length > 0 &&
    (value.lineNumber === undefined || isFiniteNumber(value.lineNumber))
  );
}
