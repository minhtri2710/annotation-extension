import type { Annotation, CssDeclaration } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import {
  isSupportedImageMimeType,
  normalizeAttachmentName,
  validateImageBlob,
  MAX_ATTACHMENTS,
} from '../attachments/validation';
import { SUPPORTED_IMAGE_MIME_TYPES } from '../attachments/validation';
import { attachmentKey, screenshotKey } from '../blob-store';
import type { ElementContext } from '../capture/context';
import { createNotePanelPersistence, type NotePanelPersistence } from './persistence';

export interface NotePanel {
  render(context: ElementContext): Promise<void>;
  teardown(): void;
}

export function createNotePanel(
  panel: HTMLElement,
  persistence: NotePanelPersistence = createNotePanelPersistence(),
): NotePanel {
  let selectedContext: ElementContext | undefined;
  let statusMessage: string | undefined;
  const previewUrls = new Set<string>();

  async function render(context: ElementContext): Promise<void> {
    if (selectedContext && selectedContext.selector !== context.selector) statusMessage = undefined;
    selectedContext = context;
    let annotations: Annotation[] = [];
    try {
      annotations = (await persistence.listAnnotations(context.url)).filter(
        (annotation) => annotation.selector === context.selector,
      );
    } catch (error) {
      statusMessage = errorMessage(error);
    }
    if (selectedContext !== context) return;

    revokePreviewUrls();
    panel.replaceChildren();
    const document = panel.ownerDocument;
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';
    panel.append(heading);
    let status: HTMLParagraphElement | undefined;
    const showStatus = () => {
      if (!statusMessage) return;
      if (!status) {
        status = document.createElement('p');
        status.dataset.annotationStatus = '';
      }
      status.textContent = statusMessage;
      if (!status.isConnected) panel.insertBefore(status, panel.children[1] ?? null);
    };
    showStatus();

    for (const annotation of annotations) {
      try {
        const item = await createAnnotationItem(document, annotation, context, (error) => {
          statusMessage = errorMessage(error);
          showStatus();
        });
        if (selectedContext !== context) return;
        panel.append(item);
      } catch (error) {
        statusMessage = errorMessage(error);
        showStatus();
      }
    }

    const form = document.createElement('form');
    const note = document.createElement('textarea');
    note.dataset.annotationNewNote = '';
    note.setAttribute('aria-label', 'New note');
    const save = document.createElement('button');
    save.type = 'submit';
    save.dataset.annotationSave = '';
    save.textContent = 'Save';
    const add = () => {
      const value = note.value.trim();
      if (!value) return;
      void mutate({
        type: 'annotation.add',
        pageUrl: context.url,
        input: { note: value, selector: context.selector, elementContext: context },
      }, context).catch(() => undefined);
    };
    save.addEventListener('click', add);
    form.append(note, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.submitter !== save) add();
    });
    panel.append(form);
  }

  async function mutate(message: AnnotationWriteMessage, context: ElementContext): Promise<void> {
    try {
      await persistence.sendAnnotationWrite(message);
      statusMessage = undefined;
      await render(context);
    } catch (error) {
      statusMessage = errorMessage(error);
      await render(context);
    }
  }

  async function addFiles(
    annotation: Annotation,
    context: ElementContext,
    files: File[],
  ): Promise<void> {
    const existingCount = annotation.attachments?.length ?? 0;
    if (existingCount + files.length > MAX_ATTACHMENTS) {
      throw new Error('An annotation can have at most 5 attachments.');
    }
    for (const file of files) {
      if (!isSupportedImageMimeType(file.type)) throw new Error(`Unsupported image mime type: ${file.type}.`);
      validateImageBlob(file, file.type);
      const name = normalizeAttachmentName(file.name, file.type);
      const base64 = await fileToBase64(file);
      await persistence.addAttachment({
        pageUrl: context.url,
        annotationId: annotation.id,
        name,
        mimeType: file.type,
        base64,
      });
    }
  }

  function reportFileError(error: unknown, context: ElementContext): void {
    statusMessage = errorMessage(error);
    void render(context).catch((renderError) => {
      statusMessage = errorMessage(renderError);
    });
  }

  async function createAnnotationItem(
    document: Document,
    annotation: Annotation,
    context: ElementContext,
    reportReadError: (error: unknown) => void,
  ): Promise<HTMLElement> {
    const item = document.createElement('article');
    item.dataset.annotationId = annotation.id;
    if (annotation.status === 'resolved') item.dataset.annotationStatus = 'resolved';
    if (annotation.cssEdits && annotation.cssEdits.length > 0) {
      persistence.applyCssEdits(annotation, annotation.cssEdits);
    }
    const note = document.createElement('textarea');
    note.dataset.annotationEditNote = '';
    note.value = annotation.note;
    note.setAttribute('aria-label', `Edit note ${annotation.id}`);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.annotationEdit = '';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      const value = note.value.trim();
      if (!value) return;
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { note: value },
        },
        context,
      );
    });
    note.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(annotation, context, files).then(
        () => render(context),
        (error) => reportFileError(error, context),
      );
    });
    const statusToggle = document.createElement('button');
    statusToggle.type = 'button';
    statusToggle.dataset.annotationStatusToggle = '';
    statusToggle.textContent = annotation.status === 'resolved' ? 'Reopen' : 'Resolve';
    statusToggle.addEventListener('click', () => {
      void mutate({
        type: 'annotation.update',
        pageUrl: context.url,
        id: annotation.id,
        changes: { status: annotation.status === 'resolved' ? 'open' : 'resolved' },
      }, context);
    });
    const capture = document.createElement('button');
    capture.type = 'button';
    capture.dataset.annotationCaptureScreenshot = '';
    capture.textContent = 'Capture screenshot';
    capture.addEventListener('click', () => {
      void (async () => {
        try {
          await persistence.captureScreenshot(annotation, context);
          statusMessage = undefined;
          await render(context);
        } catch (error) {
          statusMessage = errorMessage(error);
          await render(context);
        }
      })();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      void mutate(
        { type: 'annotation.delete', pageUrl: context.url, id: annotation.id },
        context,
      );
    });
    const attachmentInput = document.createElement('input');
    attachmentInput.type = 'file';
    attachmentInput.accept = SUPPORTED_IMAGE_MIME_TYPES.join(',');
    attachmentInput.multiple = true;
    attachmentInput.dataset.annotationAttachmentInput = '';
    attachmentInput.addEventListener('change', () => {
      const files = Array.from(attachmentInput.files ?? []);
      if (files.length === 0) return;
      void addFiles(annotation, context, files).then(
        () => render(context),
        (error) => reportFileError(error, context),
      );
      attachmentInput.value = '';
    });
    item.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(annotation, context, files).then(
        () => render(context),
        (error) => reportFileError(error, context),
      );
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
    const attachmentLabel = document.createElement('label');
    attachmentLabel.textContent = 'Attach image';
    attachmentLabel.append(attachmentInput);
    const reproSteps = document.createElement('textarea');
    reproSteps.dataset.annotationReproSteps = '';
    reproSteps.value = annotation.repro?.steps.join('\n') ?? '';
    reproSteps.setAttribute('aria-label', `Reproduction steps ${annotation.id}`);
    const reproExpected = document.createElement('textarea');
    reproExpected.dataset.annotationReproExpected = '';
    reproExpected.value = annotation.repro?.expected ?? '';
    reproExpected.setAttribute('aria-label', `Expected result ${annotation.id}`);
    const reproActual = document.createElement('textarea');
    reproActual.dataset.annotationReproActual = '';
    reproActual.value = annotation.repro?.actual ?? '';
    reproActual.setAttribute('aria-label', `Actual result ${annotation.id}`);
    const cssDecls = document.createElement('textarea');
    cssDecls.dataset.annotationCssDecls = '';
    cssDecls.value = annotation.cssEdits?.map(({ property, value }) => `${property}: ${value}`).join('\n') ?? '';
    cssDecls.setAttribute('aria-label', `CSS declarations ${annotation.id}`);
    const saveCss = document.createElement('button');
    saveCss.type = 'button';
    saveCss.dataset.annotationCssSave = '';
    saveCss.textContent = 'Save CSS';
    saveCss.addEventListener('click', () => {
      const declarations = parseCssDeclarations(cssDecls.value);
      if (declarations.length === 0) return;
      const edits = persistence.applyCssEdits(annotation, declarations);
      if (!edits) {
        reportReadError(new Error('Element not found on this page; CSS tweaks were not saved.'));
        return;
      }
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { cssEdits: edits },
        },
        context,
      );
    });
    const clearCss = document.createElement('button');
    clearCss.type = 'button';
    clearCss.dataset.annotationCssClear = '';
    clearCss.textContent = 'Clear tweaks';
    clearCss.addEventListener('click', () => {
      persistence.revertCssEdits(annotation);
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { cssEdits: [] },
        },
        context,
      );
    });
    const saveRepro = document.createElement('button');
    saveRepro.type = 'button';
    saveRepro.dataset.annotationReproSave = '';
    saveRepro.textContent = 'Save repro';
    saveRepro.addEventListener('click', () => {
      const steps = reproSteps.value
        .split(/\r?\n/)
        .map((step) => step.trim())
        .filter(Boolean);
      const expected = reproExpected.value.trim();
      const actual = reproActual.value.trim();
      if (steps.length === 0 && !expected && !actual) return;
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { repro: { steps, expected, actual } },
        },
        context,
      );
    });
    item.append(
      note,
      edit,
      statusToggle,
      capture,
      remove,
      attachmentLabel,
      cssDecls,
      saveCss,
      reproSteps,
      reproExpected,
      reproActual,
      saveRepro,
    );
    if (annotation.cssEdits && annotation.cssEdits.length > 0) {
      item.append(clearCss);
      const readout = document.createElement('ul');
      readout.dataset.annotationCss = '';
      for (const { property, value, original } of annotation.cssEdits) {
        const entry = document.createElement('li');
        entry.textContent = `${property}: ${original} -> ${value}`;
        readout.append(entry);
      }
      item.append(readout);
    }
    if (annotation.repro) {
      const readout = document.createElement('div');
      readout.dataset.annotationRepro = '';
      const stepsList = document.createElement('ol');
      for (const step of annotation.repro.steps) {
        const listItem = document.createElement('li');
        listItem.textContent = step;
        stepsList.append(listItem);
      }
      const expected = document.createElement('p');
      expected.textContent = `Expected: ${annotation.repro.expected}`;
      const actual = document.createElement('p');
      actual.textContent = `Actual: ${annotation.repro.actual}`;
      readout.append(stepsList, expected, actual);
      item.append(readout);
    }
    if (annotation.screenshot) {
      try {
        const blob = await persistence.readBlob(screenshotKey(annotation.id));
        appendPreview(document, item, blob, 'Annotation screenshot', 'data-annotation-screenshot');
      } catch (error) {
        reportReadError(error);
      }
    }
    for (const attachment of annotation.attachments ?? []) {
      try {
        const blob = await persistence.readBlob(attachmentKey(attachment.id));
        const wrapper = document.createElement('figure');
        wrapper.dataset.annotationAttachment = attachment.id;
        appendPreview(document, wrapper, blob, attachment.name, 'data-annotation-attachment-preview');
        const caption = document.createElement('figcaption');
        caption.textContent = attachment.name;
        const removeAttachment = document.createElement('button');
        removeAttachment.type = 'button';
        removeAttachment.dataset.annotationAttachmentDelete = attachment.id;
        removeAttachment.textContent = 'Remove';
        removeAttachment.addEventListener('click', () => {
          void persistence.deleteAttachment({
            pageUrl: context.url,
            annotationId: annotation.id,
            attachmentId: attachment.id,
          }).then(() => render(context), (error) => reportFileError(error, context));
        });
        wrapper.append(caption, removeAttachment);
        item.append(wrapper);
      } catch (error) {
        reportReadError(error);
      }
    }
    return item;
  }

  function appendPreview(
    document: Document,
    parent: HTMLElement,
    blob: Blob,
    alt: string,
    dataAttribute: string,
  ): void {
    const preview = document.createElement('img');
    preview.setAttribute(dataAttribute, '');
    const url = URL.createObjectURL(blob);
    previewUrls.add(url);
    preview.src = url;
    preview.alt = alt;
    parent.append(preview);
  }

  function revokePreviewUrls(): void {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls.clear();
  }

  function teardown(): void {
    revokePreviewUrls();
    persistence.revertAllCssEdits();
  }

  return { render, teardown };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCssDeclarations(value: string): CssDeclaration[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator === -1) return [];

    const property = line.slice(0, separator).trim();
    const editValue = line.slice(separator + 1).trim();
    return property && editValue ? [{ property, value: editValue }] : [];
  });
}

async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
