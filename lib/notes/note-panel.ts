import type { Annotation, CssDeclaration } from '../annotation';
import { errorMessage } from '../guards';
import { blobToBase64 } from '../base64';
import { annotationWriteError, MAX_TEXT_LENGTH, type AnnotationWriteMessage } from '../annotation-messages';
import {
  imageTypeOf,
  normalizeAttachmentName,
  validateImageBlob,
  MAX_ATTACHMENTS,
} from '../attachments/validation';
import { SUPPORTED_IMAGE_MIME_TYPES } from '../attachments/validation';
import { attachmentKey, screenshotKey } from '../blob-store';
import type { ElementContext } from '../capture/context';
import { formatElementContext } from '../export/format';
import { createNotePanelPersistence, type NotePanelPersistence } from './persistence';
import { createInlineConfirm, keepPanelFocus } from '../ui/shell';
import { ScreenshotCaptureError } from '../screenshot/messages';

export interface NotePanel {
  render(context: ElementContext): Promise<void>;
  clear(): void;
  teardown(): void;
  /** Re-reads the page's annotations after a storage change; typed text is never overwritten. */
  syncWithStorage(): Promise<void>;
  live: HTMLElement;
}

// Dispatched on the panel mount when the user asks to close the note panel.
export const NOTE_PANEL_CLOSE_EVENT = 'annotation-note-close';
const EMPTY_NOTE_MESSAGE = 'Write a note before saving.';
const NOTE_SAVED_MESSAGE = 'Note saved.';
const DELETED_ELSEWHERE_MESSAGE = 'This annotation was deleted in another tab.';
const CHANGED_ELSEWHERE_MESSAGE = 'This annotation changed in another tab.';
const DRAFT_RESTORED_MESSAGE = 'Draft restored.';

export function createNotePanel(
  panel: HTMLElement,
  persistence: NotePanelPersistence = createNotePanelPersistence(),
): NotePanel {
  let selectedContext: ElementContext | undefined;
  let statusMessage: string | undefined;
  // Shows statusMessage in the current render without re-rendering, so typed text survives.
  let showCurrentStatus = () => {};
  // What the current render shows (ids, update times and page positions), and how many of this panel's writes are in flight.
  let shownVersion = '';
  let pendingWrites = 0;
  const previewUrls = new Set<string>();
  // Unsaved note text, kept in memory across re-renders and reopening: new notes by page URL and selector, edits by id.
  const drafts = new Map<string, string>();
  let restoredDraft = false;
  // CSS and repro groups the user left open or closed against their content default, kept in memory by annotation id and group.
  const groupStates = new Map<string, boolean>();
  const live = panel.ownerDocument.createElement('p');
  live.dataset.annotationLive = '';
  live.setAttribute('role', 'status');

  function announce(text: string): void {
    if (live.textContent !== text) live.textContent = text;
  }

  // Opening moves focus into the panel: the first note of the element, else the new-note field.
  async function render(context: ElementContext): Promise<void> {
    await refresh(context);
    if (selectedContext !== context) return;
    if (restoredDraft && !statusMessage) {
      statusMessage = DRAFT_RESTORED_MESSAGE;
      showCurrentStatus();
    }
    panel
      .querySelector<HTMLTextAreaElement>('[data-annotation-edit-note], [data-annotation-new-note]')
      ?.focus();
  }

  async function refresh(context: ElementContext): Promise<void> {
    if (selectedContext && selectedContext.selector !== context.selector) statusMessage = undefined;
    selectedContext = context;
    let pageAnnotations: Annotation[] = [];
    try {
      pageAnnotations = await persistence.listAnnotations(context.url);
    } catch (error) {
      statusMessage = errorMessage(error);
    }
    if (selectedContext !== context) return;
    // Names use the annotation's 1-based position on the page, as the annotation list does.
    const positions = new Map(pageAnnotations.map((annotation, index) => [annotation.id, index + 1]));
    const annotations = pageAnnotations.filter((annotation) => annotation.selector === context.selector);

    shownVersion = versionOf(pageAnnotations, context.selector);
    restoredDraft = false;
    revokePreviewUrls();
    const restoreFocus = keepPanelFocus(panel);
    panel.replaceChildren();
    const document = panel.ownerDocument;
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';
    heading.tabIndex = -1;
    const hint = document.createElement('p');
    hint.dataset.annotationHint = '';
    hint.textContent = formatElementContext(context) ?? context.selector;
    hint.title = context.selector;
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.annotationClose = '';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close annotation note');
    close.addEventListener('click', () => panel.dispatchEvent(new Event(NOTE_PANEL_CLOSE_EVENT)));
    panel.append(heading, hint, close);
    let status: HTMLParagraphElement | undefined;
    const showStatus = () => {
      announce(statusMessage ?? '');
      if (!statusMessage) return;
      if (!status) {
        status = document.createElement('p');
        status.dataset.annotationStatus = '';
      }
      status.textContent = statusMessage;
      if (!status.isConnected) panel.insertBefore(status, close.nextSibling);
    };
    showStatus();
    showCurrentStatus = showStatus;

    for (const annotation of annotations) {
      try {
        const item = await createAnnotationItem(document, annotation, positions.get(annotation.id)!, context, (error) => {
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
    note.maxLength = MAX_TEXT_LENGTH;
    note.setAttribute('aria-label', 'New note');
    const draftKey = newNoteDraftKey(context.url, context.selector);
    restoreDraft(note, draftKey);
    note.addEventListener('input', () => {
      if (note.value.trim()) drafts.set(draftKey, note.value);
      else drafts.delete(draftKey);
    });
    const save = document.createElement('button');
    save.type = 'submit';
    save.dataset.annotationSave = '';
    save.textContent = 'Save';
    const add = () => {
      const value = note.value.trim();
      if (!value) {
        statusMessage = EMPTY_NOTE_MESSAGE;
        showStatus();
        return;
      }
      void mutate({
        type: 'annotation.add',
        pageUrl: context.url,
        input: { note: value, selector: context.selector, elementContext: context },
      }, context, NOTE_SAVED_MESSAGE).catch(() => undefined);
    };
    save.addEventListener('click', add);
    note.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      add();
    });
    form.append(note, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.submitter !== save) add();
    });
    panel.append(form);
    restoreFocus();
  }

  async function mutate(
    message: AnnotationWriteMessage,
    context: ElementContext,
    successMessage?: string,
  ): Promise<void> {
    const refusal = annotationWriteError(message);
    if (refusal) {
      statusMessage = refusal;
      showCurrentStatus();
      return;
    }
    await whileWriting(async () => {
      try {
        const result = await persistence.sendAnnotationWrite(message);
        // The background answers null (update) or false (delete) when the id is no longer stored.
        const missing = (message.type === 'annotation.update' && result === null)
          || (message.type === 'annotation.delete' && result === false);
        if (!missing) dropDraft(message);
        statusMessage = missing ? DELETED_ELSEWHERE_MESSAGE : successMessage;
        await refresh(context);
      } catch (error) {
        statusMessage = errorMessage(error);
        await refresh(context);
      }
    });
  }

  function restoreDraft(field: HTMLTextAreaElement, key: string): void {
    const draft = drafts.get(key);
    if (draft === undefined) return;
    field.value = draft;
    restoredDraft = true;
  }

  function dropDraft(message: AnnotationWriteMessage): void {
    if (message.type === 'annotation.add') drafts.delete(newNoteDraftKey(message.pageUrl, message.input.selector));
    else if (message.type === 'annotation.delete') drafts.delete(editDraftKey(message.id));
    else if (message.type === 'annotation.update' && message.changes.note !== undefined) drafts.delete(editDraftKey(message.id));
  }

  async function whileWriting(operation: () => Promise<void>): Promise<void> {
    pendingWrites += 1;
    try {
      await operation();
    } finally {
      pendingWrites -= 1;
    }
  }

  // This panel's own writes re-render when they finish, so only changes made elsewhere reach here.
  async function syncWithStorage(): Promise<void> {
    const context = selectedContext;
    if (!context || pendingWrites > 0) return;
    let annotations: Annotation[];
    try {
      annotations = await persistence.listAnnotations(context.url);
    } catch (error) {
      statusMessage = errorMessage(error);
      showCurrentStatus();
      return;
    }
    if (selectedContext !== context || pendingWrites > 0) return;
    if (versionOf(annotations, context.selector) === shownVersion) return;
    const typing = Array.from(panel.querySelectorAll('textarea')).some((field) => field.value !== field.defaultValue);
    if (typing) {
      statusMessage = CHANGED_ELSEWHERE_MESSAGE;
      showCurrentStatus();
      return;
    }
    await refresh(context);
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
      // file.type comes from the extension; the bytes decide what is stored.
      const mimeType = await imageTypeOf(file);
      if (!mimeType) throw new Error(`${file.name} is not a PNG, JPEG or WebP image.`);
      await validateImageBlob(file, mimeType);
      const name = normalizeAttachmentName(file.name, mimeType);
      const base64 = await blobToBase64(file);
      await persistence.addAttachment({
        pageUrl: context.url,
        annotationId: annotation.id,
        name,
        mimeType,
        base64,
      });
    }
  }

  function reportFileSuccess(context: ElementContext): Promise<void> {
    statusMessage = undefined;
    return refresh(context);
  }

  function reportFileError(error: unknown, context: ElementContext): void {
    statusMessage = errorMessage(error);
    void refresh(context).catch((renderError) => {
      statusMessage = errorMessage(renderError);
    });
  }

  async function createAnnotationItem(
    document: Document,
    annotation: Annotation,
    position: number,
    context: ElementContext,
    reportReadError: (error: unknown) => void,
  ): Promise<HTMLElement> {
    const item = document.createElement('article');
    item.dataset.annotationId = annotation.id;
    if (annotation.status === 'resolved') item.dataset.annotationStatus = 'resolved';
    if (annotation.cssEdits && annotation.cssEdits.length > 0) {
      persistence.applyCssEdits(annotation, annotation.cssEdits);
    }
    const images = imagesSection(document, item, annotation, context, reportReadError);
    const css = cssSection(document, annotation, position, context, reportReadError);
    const repro = reproSection(document, annotation, position, context);
    const hasCss = (annotation.cssEdits?.length ?? 0) > 0;
    item.append(
      ...noteSection(document, annotation, position, context),
      ...images.controls,
      group(document, annotation.id, 'css', 'CSS tweaks', hasCss, [...css.controls, ...css.readout]),
      group(document, annotation.id, 'repro', 'Reproduction steps', annotation.repro !== undefined, [
        ...repro.controls,
        ...repro.readout,
      ]),
    );
    await images.appendPreviews();
    return item;
  }

  // A group starts open when it has content, unless the user left it the other way. The initial toggle event
  // arrives after the listener in real browsers, so a state that matches the content default is not stored.
  function group(
    document: Document,
    id: string,
    name: 'css' | 'repro',
    title: string,
    hasContent: boolean,
    children: HTMLElement[],
  ): HTMLDetailsElement {
    const details = document.createElement('details');
    details.dataset[name === 'css' ? 'annotationCssGroup' : 'annotationReproGroup'] = '';
    const key = `${id} ${name}`;
    details.open = groupStates.get(key) ?? hasContent;
    details.addEventListener('toggle', () => {
      if (details.open === hasContent) groupStates.delete(key);
      else groupStates.set(key, details.open);
    });
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary, ...children);
    return details;
  }

  function noteSection(
    document: Document,
    annotation: Annotation,
    position: number,
    context: ElementContext,
  ): HTMLElement[] {
    const note = document.createElement('textarea');
    note.dataset.annotationEditNote = '';
    note.maxLength = MAX_TEXT_LENGTH;
    note.defaultValue = annotation.note;
    note.setAttribute('aria-label', `Edit note, annotation ${position}`);
    const draftKey = editDraftKey(annotation.id);
    restoreDraft(note, draftKey);
    const unsaved = document.createElement('p');
    unsaved.dataset.annotationUnsaved = '';
    unsaved.textContent = 'Unsaved changes';
    unsaved.hidden = note.value === annotation.note;
    note.addEventListener('input', () => {
      unsaved.hidden = note.value === annotation.note;
      if (unsaved.hidden) drafts.delete(draftKey);
      else drafts.set(draftKey, note.value);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.annotationEdit = '';
    edit.textContent = 'Save note';
    const saveNote = () => {
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
    };
    edit.addEventListener('click', saveNote);
    note.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      saveNote();
    });
    note.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => reportFileSuccess(context),
        (error) => reportFileError(error, context),
      ));
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
      void whileWriting(async () => {
        try {
          await persistence.captureScreenshot(annotation, context);
          statusMessage = undefined;
          await refresh(context);
        } catch (error) {
          statusMessage = screenshotFailureMessage(error);
          await refresh(context);
        }
      });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.textContent = 'Delete';
    const dismissDelete = createInlineConfirm(document, {
      trigger: remove,
      question: 'Delete this annotation? This cannot be undone.',
      confirmLabel: 'Delete',
      ariaLabel: 'Confirm delete annotation',
      onConfirm: () => {
        dismissDelete();
        void mutate(
          { type: 'annotation.delete', pageUrl: context.url, id: annotation.id },
          context,
        );
      },
      dataPrefix: 'annotation-delete',
    });
    return [note, edit, statusToggle, capture, remove, unsaved];
  }

  // The file input sits with the note controls; previews follow the groups once their blobs are read.
  function imagesSection(
    document: Document,
    item: HTMLElement,
    annotation: Annotation,
    context: ElementContext,
    reportReadError: (error: unknown) => void,
  ): { controls: HTMLElement[]; appendPreviews: () => Promise<void> } {
    const attachmentInput = document.createElement('input');
    attachmentInput.type = 'file';
    attachmentInput.accept = SUPPORTED_IMAGE_MIME_TYPES.join(',');
    attachmentInput.multiple = true;
    attachmentInput.dataset.annotationAttachmentInput = '';
    attachmentInput.addEventListener('change', () => {
      const files = Array.from(attachmentInput.files ?? []);
      if (files.length === 0) return;
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => reportFileSuccess(context),
        (error) => reportFileError(error, context),
      ));
      attachmentInput.value = '';
    });
    item.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => reportFileSuccess(context),
        (error) => reportFileError(error, context),
      ));
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
    const attachmentLabel = document.createElement('label');
    attachmentLabel.textContent = 'Attach image';
    attachmentLabel.append(attachmentInput);
    const appendPreviews = async () => {
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
            void whileWriting(() => persistence.deleteAttachment({
              pageUrl: context.url,
              annotationId: annotation.id,
              attachmentId: attachment.id,
            }).then(() => reportFileSuccess(context), (error) => reportFileError(error, context)));
          });
          wrapper.append(caption, removeAttachment);
          item.append(wrapper);
        } catch (error) {
          reportReadError(error);
        }
      }
    };
    return { controls: [attachmentLabel], appendPreviews };
  }

  function cssSection(
    document: Document,
    annotation: Annotation,
    position: number,
    context: ElementContext,
    reportReadError: (error: unknown) => void,
  ): { controls: HTMLElement[]; readout: HTMLElement[] } {
    const { field: cssDecls, label: cssDeclsLabel } = labelledField(
      document,
      position,
      'CSS declarations',
      annotation.cssEdits?.map(({ property, value }) => `${property}: ${value}`).join('\n') ?? '',
    );
    cssDecls.dataset.annotationCssDecls = '';
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
    if (!annotation.cssEdits || annotation.cssEdits.length === 0) {
      return { controls: [cssDeclsLabel, saveCss], readout: [] };
    }
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
    const readout = document.createElement('ul');
    readout.dataset.annotationCss = '';
    for (const { property, value, original } of annotation.cssEdits) {
      const entry = document.createElement('li');
      entry.textContent = `${property}: ${original} -> ${value}`;
      readout.append(entry);
    }
    return { controls: [cssDeclsLabel, saveCss], readout: [clearCss, readout] };
  }

  function reproSection(
    document: Document,
    annotation: Annotation,
    position: number,
    context: ElementContext,
  ): { controls: HTMLElement[]; readout: HTMLElement[] } {
    const { field: reproSteps, label: reproStepsLabel } = labelledField(
      document,
      position,
      'Reproduction steps',
      annotation.repro?.steps.join('\n') ?? '',
    );
    reproSteps.dataset.annotationReproSteps = '';
    const { field: reproExpected, label: reproExpectedLabel } = labelledField(
      document,
      position,
      'Expected result',
      annotation.repro?.expected ?? '',
    );
    reproExpected.dataset.annotationReproExpected = '';
    const { field: reproActual, label: reproActualLabel } = labelledField(
      document,
      position,
      'Actual result',
      annotation.repro?.actual ?? '',
    );
    reproActual.dataset.annotationReproActual = '';
    for (const field of [reproSteps, reproExpected, reproActual]) field.maxLength = MAX_TEXT_LENGTH;
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
    const controls = [reproStepsLabel, reproExpectedLabel, reproActualLabel, saveRepro];
    if (!annotation.repro) return { controls, readout: [] };
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
    return { controls, readout: [readout] };
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

  function clear(): void {
    selectedContext = undefined;
    statusMessage = undefined;
    revokePreviewUrls();
    panel.replaceChildren();
    announce('');
  }

  function teardown(): void {
    drafts.clear();
    revokePreviewUrls();
    persistence.revertAllCssEdits();
  }

  return { render, clear, teardown, syncWithStorage, live };
}

function newNoteDraftKey(url: string, selector: string): string {
  return `new ${url} ${selector}`;
}

function editDraftKey(id: string): string {
  return `edit ${id}`;
}

function versionOf(pageAnnotations: Annotation[], selector: string): string {
  return pageAnnotations
    .flatMap(({ id, updatedAt, selector: shown }, index) => shown === selector ? [`${id}@${updatedAt}#${index + 1}`] : [])
    .join(' ');
}

function screenshotFailureMessage(error: unknown): string {
  if (!(error instanceof ScreenshotCaptureError) || error.failure.kind === 'failed') {
    return `Screenshot failed: ${errorMessage(error)}`;
  }
  const { shortcut } = error.failure;
  const grant = shortcut ? `toolbar icon, or press ${shortcut},` : 'toolbar icon';
  return `The screenshot needs your permission on this tab. Click the extension's ${grant} once on this tab, then select Capture screenshot again.`;
}

// Each field sits in a visible label; its accessible name starts with that label text.
function labelledField(
  document: Document,
  position: number,
  text: string,
  value: string,
): { field: HTMLTextAreaElement; label: HTMLLabelElement } {
  const field = document.createElement('textarea');
  field.defaultValue = value;
  field.setAttribute('aria-label', `${text}, annotation ${position}`);
  const label = document.createElement('label');
  label.append(text, field);
  return { field, label };
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
