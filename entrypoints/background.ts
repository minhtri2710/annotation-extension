import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  isAnnotationWriteMessage,
  type AnnotationWriteMessage,
} from '../lib/annotation-messages';
import { isScreenshotCaptureMessage } from '../lib/screenshot/messages';
import {
  addAnnotation,
  clearAnnotations,
  deleteAnnotation,
  updateAnnotation,
} from '../lib/annotation-storage';
import { CAPTURE_TOGGLE_MESSAGE } from '../lib/capture';

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== CAPTURE_TOGGLE_MESSAGE) return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    await browser.tabs.sendMessage(tab.id, { type: CAPTURE_TOGGLE_MESSAGE });
  });

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

    mutation.then(sendResponse);
    return true;
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isScreenshotCaptureMessage(message)) return;

    browser.tabs.captureVisibleTab().then(sendResponse);
    return true;
  });
});
