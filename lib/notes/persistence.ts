import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { listAnnotations } from '../annotation-storage';
import type { Annotation, CssDeclaration, CssEdit } from '../annotation';
import { sendScreenshotCapture, sendBlobRead } from '../screenshot/messages';
import type { AttachmentMetadata } from '../annotation';
import { sendAttachmentAdd, sendAttachmentDelete } from '../attachments/messages';
import type { ElementContext } from '../capture/context';
import { resolveElementBox, resolveSelector } from '../capture/selector';

export interface NotePanelPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  captureScreenshot(annotation: Annotation, context: ElementContext): Promise<Annotation['screenshot'] | undefined>;
  readBlob(key: string): Promise<Blob>;
  addAttachment(message: Omit<Parameters<typeof sendAttachmentAdd>[0], 'type'>): Promise<AttachmentMetadata>;
  deleteAttachment(message: Omit<Parameters<typeof sendAttachmentDelete>[0], 'type'>): Promise<boolean>;
  applyCssEdits(annotation: Annotation, declarations: CssDeclaration[]): { edits: CssEdit[]; refused: CssDeclaration[] } | undefined;
  revertCssEdits(annotation: Annotation): void;
  revertAllCssEdits(): void;
}

async function captureScreenshot(
  annotation: Annotation,
  context: ElementContext,
): Promise<Annotation['screenshot'] | undefined> {
  const rect = resolveElementBox(document, annotation.selector);
  if (!rect) return undefined;

  return sendScreenshotCapture({
    pageUrl: context.url,
    annotationId: annotation.id,
    rect,
    devicePixelRatio: window.devicePixelRatio,
  });
}

type AppliedCssEdits = {
  element: HTMLElement;
  originals: Map<string, string>;
};

function fetchesResource(declaration: CssDeclaration): boolean {
  const detached = document.createElement('div');
  // The detached element is never rendered, so parsing its style cannot fetch a resource.
  detached.style.setProperty(declaration.property, declaration.value);
  const serialised = detached.style.getPropertyValue(declaration.property).toLowerCase();
  // A custom property keeps its raw text, so a backslash can hide a fetch function, and a quoted string can be read by the page's own CSS as an image-set() URL.
  return serialised.includes('url(')
    || serialised.includes('image-set(')
    || (declaration.property.startsWith('--') && (
      declaration.value.includes('\\')
      || declaration.value.includes('"')
      || declaration.value.includes("'")
    ));
}

function createCssEditRegistry() {
  const applied = new Map<string, AppliedCssEdits>();

  function applyCssEdits(
    annotation: Annotation,
    declarations: CssDeclaration[],
  ): { edits: CssEdit[]; refused: CssDeclaration[] } | undefined {
    const element = resolveSelector(document, annotation.selector);
    if (!element) return undefined;

    const target = element as HTMLElement;
    const refused: CssDeclaration[] = [];
    const allowed = declarations.filter((declaration) => {
      if (fetchesResource(declaration)) {
        refused.push(declaration);
        return false;
      }
      return true;
    });
    const previous = applied.get(annotation.id);
    const current = previous?.element === target ? previous.originals : new Map<string, string>();
    if (previous) {
      for (const property of previous.originals.keys()) {
        if (previous.element !== target || !allowed.some((edit) => edit.property === property)) {
          previous.element.style.removeProperty(property);
        }
      }
    }

    // Originals are resolved before any setProperty so one edit cannot leak into another's original.
    const edits = allowed.map(({ property, value }) => ({
      property,
      value,
      original:
        annotation.cssEdits?.find((edit) => edit.property === property)?.original ??
        current.get(property) ??
        window.getComputedStyle(target).getPropertyValue(property),
    }));
    for (const edit of edits) {
      target.style.setProperty(edit.property, edit.value);
    }
    if (edits.length === 0) applied.delete(annotation.id);
    else {
      applied.set(annotation.id, {
        element: target,
        originals: new Map(edits.map((edit) => [edit.property, edit.original])),
      });
    }
    return { edits, refused };
  }

  function revertCssEdits(annotation: Annotation): void {
    if (!resolveSelector(document, annotation.selector)) return;
    const tracked = applied.get(annotation.id);
    if (!tracked) return;

    for (const property of tracked.originals.keys()) {
      tracked.element.style.removeProperty(property);
    }
    applied.delete(annotation.id);
  }

  function revertAllCssEdits(): void {
    for (const tracked of applied.values()) {
      for (const property of tracked.originals.keys()) {
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
