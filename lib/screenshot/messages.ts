import { browser } from 'wxt/browser';

export type ScreenshotCaptureMessage = { type: 'screenshot.capture' };

export function isScreenshotCaptureMessage(value: unknown): value is ScreenshotCaptureMessage {
  return isRecord(value) && value.type === 'screenshot.capture';
}

export function sendScreenshotCapture(): Promise<string> {
  return browser.runtime.sendMessage<ScreenshotCaptureMessage, string>({
    type: 'screenshot.capture',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
