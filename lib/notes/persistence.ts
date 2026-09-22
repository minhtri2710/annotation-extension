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
  revertCssEdits(annotation: Annotation): void;
  revertAllCssEdits(): void;
}

async function captureScreenshot(annotation: Annotation): Promise<string | undefined> {
  const element = document.querySelector(annotation.selector);
  if (!element) return undefined;

  const boundingBox = element.getBoundingClientRect();
  const visibleTab = await sendScreenshotCapture();
  return cropDataUrl(visibleTab, boundingBox, window.devicePixelRatio);
}

type AppliedCssEdits = {
  element: HTMLElement;
  properties: Set<string>;
};

function createCssEditRegistry() {
  const applied = new Map<string, AppliedCssEdits>();

  function applyCssEdits(annotation: Annotation, edits: CssEdit[]): void {
    const element = document.querySelector(annotation.selector);
    if (!element) return;

    const target = element as HTMLElement;
    const previous = applied.get(annotation.id);
    if (previous) {
      for (const property of previous.properties) {
        if (previous.element !== target || !edits.some((edit) => edit.property === property)) {
          previous.element.style.removeProperty(property);
        }
      }
    }

    const properties = new Set(edits.map((edit) => edit.property));
    for (const edit of edits) {
      target.style.setProperty(edit.property, edit.value);
    }
    if (properties.size === 0) applied.delete(annotation.id);
    else applied.set(annotation.id, { element: target, properties });
  }

  function revertCssEdits(annotation: Annotation): void {
    if (!document.querySelector(annotation.selector)) return;
    const tracked = applied.get(annotation.id);
    if (!tracked) return;

    for (const property of tracked.properties) {
      tracked.element.style.removeProperty(property);
    }
    applied.delete(annotation.id);
  }

  function revertAllCssEdits(): void {
    for (const tracked of applied.values()) {
      for (const property of tracked.properties) {
        tracked.element.style.removeProperty(property);
      }
    }
    applied.clear();
  }

  return { applyCssEdits, revertCssEdits, revertAllCssEdits };
}

export function createNotePanelPersistence(): NotePanelPersistence {
  return {
    listAnnotations,
    sendAnnotationWrite,
    captureScreenshot,
    ...createCssEditRegistry(),
  };
}
