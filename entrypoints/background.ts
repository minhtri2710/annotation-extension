import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  isAnnotationWriteMessage,
  type AnnotationWriteMessage,
} from '../lib/annotation-messages';
import {
  addAnnotation,
  clearAnnotations,
  deleteAnnotation,
  updateAnnotation,
} from '../lib/annotation-storage';

export default defineBackground(() => {
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
});
