import { browser } from 'wxt/browser';
import { errorMessage } from '../guards';
import { base64ToBlob, blobToBase64 } from '../base64';
import {
  addAnnotation,
  addAttachment,
  clearAnnotations,
  deleteAnnotation,
  deleteAttachment,
  updateAnnotation,
  updateAnnotationScreenshot,
} from '../annotation-storage';
import {
  annotationWriteError,
  createAnnotationErrorResponse,
  isAnnotationWriteMessage,
  isAnnotationWriteType,
} from '../annotation-messages';
import {
  isAttachmentAddMessage,
  isAttachmentDeleteMessage,
  type AttachmentAddMessage,
} from '../attachments/messages';
import { validateImageBlob, validateAttachmentName } from '../attachments/validation';
import {
  isBlobReadMessage,
  isScreenshotCaptureMessage,
  ScreenshotCaptureError,
  type BlobReadMessage,
  type ScreenshotCaptureErrorResponse,
  type ScreenshotCaptureMessage,
} from '../screenshot/messages';
import { isCaptureShortcutMessage, lookupCaptureShortcut } from '../capture/activation';
import { createBlobStore, screenshotKey, type BlobStore } from '../blob-store';
import { processScreenshot, type ScreenshotProcessor } from '../screenshot/processor';

export interface BackgroundMessageDependencies {
  blobStore?: BlobStore;
  screenshotProcessor?: ScreenshotProcessor;
}

export function registerBackgroundMessageHandlers(
  dependencies: BackgroundMessageDependencies = {},
): void {
  const blobStore = dependencies.blobStore ?? createBlobStore();
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
            return deleteAnnotation(message.pageUrl, message.id, blobStore);
          case 'annotation.clear':
            return clearAnnotations(message.pageUrl, blobStore);
        }
      })();

      return reply(mutation, sendResponse);
    }

    // A refused write still gets an answer, so the sender never resolves to undefined.
    if (isAnnotationWriteType(message)) {
      sendResponse(createAnnotationErrorResponse(new Error(annotationWriteError(message))));
      return true;
    }

    if (isScreenshotCaptureMessage(message)) {
      const capture = captureScreenshot(message, sender.tab?.windowId, blobStore, screenshotProcessor);
      void capture.then(sendResponse, (error) => sendResponse(createScreenshotCaptureErrorResponse(error)));
      return true;
    }

    if (isCaptureShortcutMessage(message)) {
      return reply(lookupCaptureShortcut().then((shortcut) => ({ shortcut })), sendResponse);
    }

    if (isAttachmentAddMessage(message)) {
      const add = addAttachmentMessage(message, blobStore);
      return reply(add, sendResponse);
    }

    if (isAttachmentDeleteMessage(message)) {
      const remove = deleteAttachment(
        message.pageUrl,
        message.annotationId,
        message.attachmentId,
        blobStore,
      );
      return reply(remove, sendResponse);
    }

    if (isBlobReadMessage(message)) {
      const read = readBlob(message, blobStore);
      return reply(read, sendResponse);
    }

    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'blob.read') {
      sendResponse(createAnnotationErrorResponse(new Error('Invalid blob key')));
      return true;
    }

    return undefined;
  });
}

function reply(result: Promise<unknown>, sendResponse: (response: unknown) => void): true {
  void result.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
  return true;
}

async function captureScreenshot(
  message: ScreenshotCaptureMessage,
  windowId: number | undefined,
  blobStore: BlobStore,
  screenshotProcessor: ScreenshotProcessor,
) {
  const capture = await captureVisibleTab(windowId);
  const processed = await screenshotProcessor(capture, message.rect, message.devicePixelRatio);
  await validateImageBlob(processed.blob);
  const key = screenshotKey(message.annotationId);
  const previousBlob = await blobStore.get(key);
  await blobStore.put(key, processed.blob);

  let annotation;
  try {
    annotation = await updateAnnotationScreenshot(message.pageUrl, message.annotationId, {
      mimeType: processed.blob.type,
      width: processed.width,
      height: processed.height,
      byteLength: processed.blob.size,
    });
  } catch (error) {
    try {
      if (previousBlob) await blobStore.put(key, previousBlob);
      else await blobStore.delete([key]);
    } catch (cleanupError) {
      throw cleanupFailure(error, cleanupError);
    }
    throw error;
  }

  if (!annotation) {
    try {
      await blobStore.delete([key]);
    } catch (cleanupError) {
      throw cleanupFailure(new Error('Annotation was not found for screenshot capture'), cleanupError);
    }
    throw new Error('Annotation was not found for screenshot capture');
  }
  return annotation.screenshot;
}

// Chrome and Firefox refuse captureVisibleTab until the user grants the tab through the action or a command.
const MISSING_GRANT = /'activeTab' permission is required|Missing activeTab permission|Missing host permission for the tab/;

async function captureVisibleTab(windowId: number | undefined): Promise<string> {
  try {
    return windowId === undefined
      ? await browser.tabs.captureVisibleTab()
      : await browser.tabs.captureVisibleTab(windowId);
  } catch (error) {
    if (!MISSING_GRANT.test(errorMessage(error))) throw error;
    const shortcut = await lookupCaptureShortcut();
    throw new ScreenshotCaptureError(shortcut ? { kind: 'needs-grant', shortcut } : { kind: 'needs-grant' });
  }
}

function createScreenshotCaptureErrorResponse(error: unknown): ScreenshotCaptureErrorResponse {
  const failure = error instanceof ScreenshotCaptureError
    ? error.failure
    : { kind: 'failed' as const, reason: errorMessage(error) };
  return { ...createAnnotationErrorResponse(error), failure };
}

async function addAttachmentMessage(
  message: AttachmentAddMessage,
  blobStore: BlobStore,
) {
  let blob: Blob;
  try {
    blob = base64ToBlob(message.base64, message.mimeType);
  } catch {
    throw new Error('Image base64 data is invalid.');
  }
  const metadata = {
    id: crypto.randomUUID(),
    name: validateAttachmentName(message.name),
    mimeType: message.mimeType,
    byteLength: blob.size,
  };
  return addAttachment(message.pageUrl, message.annotationId, metadata, blob, blobStore);
}

async function readBlob(
  message: BlobReadMessage,
  blobStore: BlobStore,
): Promise<{ mimeType: string; base64: string }> {
  const blob = await blobStore.get(message.key);
  if (!blob) throw new Error('Blob was not found');
  return { mimeType: blob.type, base64: await blobToBase64(blob) };
}

function cleanupFailure(error: unknown, cleanupError: unknown): Error {
  return new Error(`${errorMessage(error)}; cleanup failed: ${errorMessage(cleanupError)}`);
}
