import { browser } from 'wxt/browser';
import {
  isAnnotationErrorResponse,
  isScreenshotMetadata,
  type AnnotationErrorResponse,
} from '../annotation-messages';
import type { BoundingBox } from '../capture/context';
import type { ScreenshotMetadata } from '../annotation';
import { isFiniteNumber, isRecord } from '../guards';
import { isBlobKey } from '../blob-store';

export type ScreenshotCaptureMessage = {
  type: 'screenshot.capture';
  pageUrl: string;
  annotationId: string;
  rect: BoundingBox;
  devicePixelRatio: number;
};

// Why a screenshot capture failed; the background classifies it and the note panel words it.
export type ScreenshotCaptureFailure =
  | { kind: 'needs-grant'; shortcut?: string }
  | { kind: 'failed'; reason: string };

export type ScreenshotCaptureErrorResponse = AnnotationErrorResponse & { failure: ScreenshotCaptureFailure };

export class ScreenshotCaptureError extends Error {
  constructor(readonly failure: ScreenshotCaptureFailure) {
    super(failure.kind === 'failed' ? failure.reason : 'Screenshot needs an activeTab grant for this tab');
    this.name = 'ScreenshotCaptureError';
  }
}

export type BlobReadMessage = { type: 'blob.read'; key: string };

export interface BlobReadResponse {
  mimeType: string;
  base64: string;
}

export function isScreenshotCaptureMessage(value: unknown): value is ScreenshotCaptureMessage {
  return (
    isRecord(value) &&
    value.type === 'screenshot.capture' &&
    typeof value.pageUrl === 'string' &&
    typeof value.annotationId === 'string' &&
    isBoundingBox(value.rect) &&
    isFiniteNumber(value.devicePixelRatio) &&
    value.devicePixelRatio > 0
  );
}

export function isScreenshotCaptureFailure(value: unknown): value is ScreenshotCaptureFailure {
  if (!isRecord(value)) return false;
  if (value.kind === 'needs-grant') return value.shortcut === undefined || typeof value.shortcut === 'string';
  return value.kind === 'failed' && typeof value.reason === 'string';
}

export function isBlobReadMessage(value: unknown): value is BlobReadMessage {
  return isRecord(value) && value.type === 'blob.read' && isBlobKey(value.key);
}

export function sendScreenshotCapture(
  message: Omit<ScreenshotCaptureMessage, 'type'>,
): Promise<ScreenshotMetadata> {
  return browser.runtime
    .sendMessage<ScreenshotCaptureMessage, ScreenshotMetadata | ScreenshotCaptureErrorResponse>({
      type: 'screenshot.capture',
      ...message,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) {
        const { failure } = response as { failure?: unknown };
        throw new ScreenshotCaptureError(
          isScreenshotCaptureFailure(failure) ? failure : { kind: 'failed', reason: 'Invalid screenshot response' },
        );
      }
      if (!isScreenshotMetadata(response)) {
        throw new ScreenshotCaptureError({ kind: 'failed', reason: 'Invalid screenshot metadata response' });
      }
      return response;
    });
}

export function sendBlobRead(key: string): Promise<Blob> {
  return browser.runtime
    .sendMessage<BlobReadMessage, BlobReadResponse | AnnotationErrorResponse>({
      type: 'blob.read',
      key,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      if (!isRecord(response) || typeof response.mimeType !== 'string' || typeof response.base64 !== 'string') {
        throw new Error('Invalid blob response');
      }
      return base64ToBlob(response.base64, response.mimeType);
    });
}

function isBoundingBox(value: unknown): value is BoundingBox {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
