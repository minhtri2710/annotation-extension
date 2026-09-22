import { browser } from 'wxt/browser';
import {
  createAnnotationErrorResponse,
  isAnnotationWriteMessage,
} from '../annotation-messages';
import { isScreenshotCaptureMessage } from '../screenshot/messages';
import {
  addAnnotation,
  clearAnnotations,
  deleteAnnotation,
  updateAnnotation,
} from '../annotation-storage';

export function registerBackgroundMessageHandlers(): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAnnotationWriteMessage(message)) return;

    const mutation = (() => {
      switch (message.type) {
        case 'annotation.add':
          return addAnnotation(message.pageUrl, message.input);
        case 'annotation.update':
          return updateAnnotation(message.pageUrl, message.id, message.changes);
        case 'annotation.delete':
          return deleteAnnotation(message.pageUrl, message.id);
        case 'annotation.clear':
          return clearAnnotations(message.pageUrl);
      }
    })();

    void mutation.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
    return true;
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isScreenshotCaptureMessage(message)) return;

    const capture = sender.tab
      ? browser.tabs.captureVisibleTab(sender.tab.windowId)
      : browser.tabs.captureVisibleTab();
    void capture.then(sendResponse, (error) => sendResponse(createAnnotationErrorResponse(error)));
    return true;
  });
}
