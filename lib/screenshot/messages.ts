import { browser } from 'wxt/browser';
import { isAnnotationErrorResponse, type AnnotationErrorResponse } from '../annotation-messages';
import { isRecord } from '../guards';

export type ScreenshotCaptureMessage = { type: 'screenshot.capture' };

export function isScreenshotCaptureMessage(value: unknown): value is ScreenshotCaptureMessage {
  return isRecord(value) && value.type === 'screenshot.capture';
}

export function sendScreenshotCapture(): Promise<string> {
  return browser.runtime
    .sendMessage<ScreenshotCaptureMessage, string | AnnotationErrorResponse>({
      type: 'screenshot.capture',
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      return response;
    });
}
