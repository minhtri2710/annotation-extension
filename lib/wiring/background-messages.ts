import { browser } from 'wxt/browser';
import {
  addAnnotation,
  clearAnnotations,
  deleteAnnotation,
  updateAnnotation,
  updateAnnotationScreenshot,
} from '../annotation-storage';
import {
  createAnnotationErrorResponse,
  isAnnotationWriteMessage,
} from '../annotation-messages';
import {
  isScreenshotCaptureMessage,
  isScreenshotReadMessage,
  type ScreenshotCaptureMessage,
} from '../screenshot/messages';
import { createScreenshotStore, type ScreenshotStore } from '../screenshot/store';
import { processScreenshot, type ScreenshotProcessor } from '../screenshot/processor';

export interface BackgroundMessageDependencies {
  screenshotStore?: ScreenshotStore;
  screenshotProcessor?: ScreenshotProcessor;
}

export function registerBackgroundMessageHandlers(
  dependencies: BackgroundMessageDependencies = {},
): void {
  const screenshotStore = dependencies.screenshotStore ?? createScreenshotStore();
  const screenshotProcessor = dependencies.screenshotProcessor ?? processScreenshot;

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isAnnotationWriteMessage(message)) {
      const mutation = (() => {
        switch (message.type) {
          case 'annotation.add':
            return addAnnotation(message.pageUrl, message.input);
          case 'annotation.update':
            return updateAnnotation(message.pageUrl, message.id, message.changes);
          case 'annotation.delete':
            return deleteAnnotation(message.pageUrl, message.id, screenshotStore);
          case 'annotation.clear':
            return clearAnnotations(message.pageUrl, screenshotStore);
        }
      })();

      void mutation.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
      return true;
    }

    if (isScreenshotCaptureMessage(message)) {
      const capture = captureScreenshot(message, sender.tab?.windowId, screenshotStore, screenshotProcessor);
      void capture.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
      return true;
    }

    if (isScreenshotReadMessage(message)) {
      const read = readScreenshot(message.annotationId, screenshotStore);
      void read.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
      return true;
    }

    return undefined;
  });
}

async function captureScreenshot(
  message: ScreenshotCaptureMessage,
  windowId: number | undefined,
  screenshotStore: ScreenshotStore,
  screenshotProcessor: ScreenshotProcessor,
) {
  const capture = windowId === undefined
    ? await browser.tabs.captureVisibleTab()
    : await browser.tabs.captureVisibleTab(windowId);
  const processed = await screenshotProcessor(capture, message.rect, message.devicePixelRatio);
  const previousBlob = await screenshotStore.get(message.annotationId);
  await screenshotStore.put(message.annotationId, processed.blob);

  let annotation;
  try {
    annotation = await updateAnnotationScreenshot(message.pageUrl, message.annotationId, {
      mimeType: processed.blob.type,
      width: processed.width,
      height: processed.height,
      byteLength: processed.blob.size,
    });
  } catch (error) {
    if (previousBlob) await screenshotStore.put(message.annotationId, previousBlob);
    else await screenshotStore.delete([message.annotationId]);
    throw error;
  }

  if (!annotation) {
    await screenshotStore.delete([message.annotationId]);
    throw new Error('Annotation was not found for screenshot capture');
  }
  return annotation.screenshot;
}

async function readScreenshot(
  annotationId: string,
  screenshotStore: ScreenshotStore,
): Promise<{ mimeType: string; base64: string }> {
  const blob = await screenshotStore.get(annotationId);
  if (!blob) throw new Error('Screenshot was not found');
  return { mimeType: blob.type, base64: await blobToBase64(blob) };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
