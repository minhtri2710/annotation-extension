import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { Annotation, CssEdit } from '../annotation';
import { cropDataUrl } from '../screenshot/crop';
import { sendScreenshotCapture } from '../screenshot/messages';

export interface NotePanelPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  captureScreenshot(annotation: Annotation): Promise<string | undefined>;
  applyCssEdits(annotation: Annotation, edits: CssEdit[]): void;
}

async function captureScreenshot(annotation: Annotation): Promise<string | undefined> {
  const element = document.querySelector(annotation.selector);
  if (!element) return undefined;

  const boundingBox = element.getBoundingClientRect();
  const visibleTab = await sendScreenshotCapture();
  return cropDataUrl(visibleTab, boundingBox, window.devicePixelRatio);
}

function applyCssEdits(annotation: Annotation, edits: CssEdit[]): void {
  const element = document.querySelector(annotation.selector);
  if (!element) return;

  for (const edit of edits) {
    (element as HTMLElement).style.setProperty(edit.property, edit.value);
  }
}

export function createNotePanelPersistence(): NotePanelPersistence {
  return { listAnnotations, sendAnnotationWrite, captureScreenshot, applyCssEdits };
}
