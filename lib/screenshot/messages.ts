import { browser } from 'wxt/browser';
import {
  isAnnotationErrorResponse,
  isScreenshotMetadata,
  type AnnotationErrorResponse,
} from '../annotation-messages';
import type { BoundingBox } from '../capture/context';
import type { ScreenshotMetadata } from '../annotation';
import { isRecord } from '../guards';

export type ScreenshotCaptureMessage = {
  type: 'screenshot.capture';
  pageUrl: string;
  annotationId: string;
  rect: BoundingBox;
  devicePixelRatio: number;
};

export type ScreenshotReadMessage = { type: 'screenshot.read'; annotationId: string };

export interface ScreenshotReadResponse {
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

export function isScreenshotReadMessage(value: unknown): value is ScreenshotReadMessage {
  return isRecord(value) && value.type === 'screenshot.read' && typeof value.annotationId === 'string';
}

export function sendScreenshotCapture(
  message: Omit<ScreenshotCaptureMessage, 'type'>,
): Promise<ScreenshotMetadata> {
  return browser.runtime
    .sendMessage<ScreenshotCaptureMessage, ScreenshotMetadata | AnnotationErrorResponse>({
      type: 'screenshot.capture',
      ...message,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      if (!isScreenshotMetadata(response)) throw new Error('Invalid screenshot metadata response');
      return response;
    });
}

export function sendScreenshotRead(annotationId: string): Promise<Blob> {
  return browser.runtime
    .sendMessage<ScreenshotReadMessage, ScreenshotReadResponse | AnnotationErrorResponse>({
      type: 'screenshot.read',
      annotationId,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      if (!isRecord(response) || typeof response.mimeType !== 'string' || typeof response.base64 !== 'string') {
        throw new Error('Invalid screenshot response');
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
