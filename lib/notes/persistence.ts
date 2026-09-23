import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { Annotation, CssEdit } from '../annotation';
import { sendScreenshotCapture, sendBlobRead } from '../screenshot/messages';
import type { AttachmentMetadata } from '../annotation';
import { sendAttachmentAdd, sendAttachmentDelete } from '../attachments/messages';
import type { ElementContext } from '../capture/context';

export interface NotePanelPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  captureScreenshot(annotation: Annotation, context: ElementContext): Promise<Annotation['screenshot'] | undefined>;
  readBlob(key: string): Promise<Blob>;
  addAttachment(message: Omit<Parameters<typeof sendAttachmentAdd>[0], 'type'>): Promise<AttachmentMetadata>;
  deleteAttachment(message: Omit<Parameters<typeof sendAttachmentDelete>[0], 'type'>): Promise<boolean>;
  applyCssEdits(annotation: Annotation, edits: CssEdit[]): void;
  revertCssEdits(annotation: Annotation): void;
  revertAllCssEdits(): void;
}

async function captureScreenshot(
  annotation: Annotation,
  context: ElementContext,
): Promise<Annotation['screenshot'] | undefined> {
  const element = document.querySelector(annotation.selector);
  if (!element) return undefined;

  const rect = element.getBoundingClientRect();
  return sendScreenshotCapture({
    pageUrl: context.url,
    annotationId: annotation.id,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    devicePixelRatio: window.devicePixelRatio,
  });
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
    readBlob: sendBlobRead,
    addAttachment: sendAttachmentAdd,
    deleteAttachment: sendAttachmentDelete,
    ...createCssEditRegistry(),
  };
}
