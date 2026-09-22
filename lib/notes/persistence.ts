import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { Annotation } from '../annotation';
import { cropDataUrl } from '../screenshot/crop';
import { sendScreenshotCapture } from '../screenshot/messages';

export interface NotePanelPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  captureScreenshot(annotation: Annotation): Promise<string | undefined>;
}

async function captureScreenshot(annotation: Annotation): Promise<string | undefined> {
  const element = document.querySelector(annotation.selector);
  if (!element) return undefined;

  const boundingBox = element.getBoundingClientRect();
  const visibleTab = await sendScreenshotCapture();
  return cropDataUrl(visibleTab, boundingBox, window.devicePixelRatio);
}

export function createNotePanelPersistence(): NotePanelPersistence {
  return { listAnnotations, sendAnnotationWrite, captureScreenshot };
}
