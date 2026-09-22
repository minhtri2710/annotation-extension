import { browser } from 'wxt/browser';
import { isRecord } from '../guards';

export type ScreenshotCaptureMessage = { type: 'screenshot.capture' };

export function isScreenshotCaptureMessage(value: unknown): value is ScreenshotCaptureMessage {
  return isRecord(value) && value.type === 'screenshot.capture';
}

export function sendScreenshotCapture(): Promise<string> {
  return browser.runtime.sendMessage<ScreenshotCaptureMessage, string>({
    type: 'screenshot.capture',
  });
}
