import { browser } from 'wxt/browser';
import {
  isAnnotationErrorResponse,
  isScreenshotMetadata,
  sendBackgroundRequest,
  type AnnotationErrorResponse,
} from '../annotation-messages';
import type { BoundingBox } from '../capture/context';
import type { ScreenshotMetadata } from '../annotation';
import { isFiniteNumber, isRecord } from '../guards';
import { isBlobKey } from '../blob-store';
import { base64ToBlob } from '../base64';

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

export async function sendBlobRead(key: string): Promise<Blob> {
  const response = await sendBackgroundRequest<BlobReadMessage, BlobReadResponse>(
    { type: 'blob.read', key },
    isBlobReadResponse,
    'Invalid blob response',
  );
  return base64ToBlob(response.base64, response.mimeType);
}

function isBlobReadResponse(value: unknown): value is BlobReadResponse {
  return isRecord(value) && typeof value.mimeType === 'string' && typeof value.base64 === 'string';
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
