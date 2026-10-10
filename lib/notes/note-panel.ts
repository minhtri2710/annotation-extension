import type { Annotation, AnnotationUpdate, CssDeclaration, Repro } from '../annotation';
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
import { createElementHint } from '../ui/element-hint';
import { createInlineConfirm, createLiveRegion, keepPanelFocus } from '../ui/shell';
import { ScreenshotCaptureError } from '../screenshot/messages';

export interface NotePanel {
  render(context: ElementContext, seed?: string): Promise<void>;
  clear(): void;
  teardown(): void;
  syncWithStorage(): Promise<void>;
  hasUnsavedDraft(): boolean;
  confirmDiscard(onDiscard: () => void): void;
  live: HTMLElement;
}

export const NOTE_PANEL_CLOSE_EVENT = 'annotation-note-close';
export const NOTE_PANEL_SAVED_EVENT = 'annotation-note-saved';
const EMPTY_NOTE_MESSAGE = 'Write a note before saving.';
const NOTHING_TO_SAVE_MESSAGE = 'No changes to save.';
const NOTE_SAVED_MESSAGE = 'Note saved.';
const DELETED_ELSEWHERE_MESSAGE = 'This annotation was deleted in another tab.';
const CHANGED_ELSEWHERE_MESSAGE = 'This annotation changed in another tab.';
const DRAFT_RESTORED_MESSAGE = 'Draft restored.';
const CSS_ELEMENT_NOT_FOUND_MESSAGE = 'Element not found on this page; CSS tweaks were not saved.';

export function createNotePanel(
  panel: HTMLElement,
  persistence: NotePanelPersistence = createNotePanelPersistence(),
): NotePanel {
  let selectedContext: ElementContext | undefined;
  let renderSequence = 0;
  let statusMessage: string | undefined;
  let showCurrentStatus = () => {};
  let shownVersion = '';
  let pendingWrites = 0;
  // Add writes in flight, keyed by new-note draft key. Held here, not per rendered form, so a refresh cannot re-enable Add.
  const pendingAdds = new Set<string>();
  const previewUrls = new Set<string>();
  const drafts = new Map<string, string>();
  const untouchedSeeds = new Set<string>();
  // Text that a write in flight sent, keyed like drafts. A field still showing it is committed, not unsaved.
  const inFlightText: Array<{ key: string; text: string }> = [];
  // Each field's draft key and whether its text is unsaved; the prompt, the Unsaved markers and Discard read these.
  const fieldStates = new WeakMap<HTMLTextAreaElement, { key: string; unsaved: () => boolean }>();
  let discardPrompt: { element: HTMLElement; onDiscard: () => void } | undefined;
  let restoredDraft = false;
  // Set by Add another note; a refresh keeps that form open until the panel is cleared.
  let expandedNewNote: string | undefined;
  const groupStates = new Map<string, boolean>();
  const { element: live, announce } = createLiveRegion(panel.ownerDocument);
  panel.addEventListener('input', syncUnsaved);

  async function render(context: ElementContext, seed?: string): Promise<void> {
    const sequence = ++renderSequence;
    const draftKey = newNoteDraftKey(context.url, context.selector);
    if (untouchedSeeds.delete(draftKey)) drafts.delete(draftKey);
    const seeded = seed !== undefined && !drafts.has(draftKey);
    if (seeded) {
      drafts.set(draftKey, seed);
      untouchedSeeds.add(draftKey);
    }
    await refresh(context);
    if (renderSequence !== sequence || selectedContext !== context) return;
    if (restoredDraft && !seeded && !statusMessage) {
      statusMessage = DRAFT_RESTORED_MESSAGE;
      showCurrentStatus();
    }
    panel
      .querySelector<HTMLTextAreaElement>(seeded ? '[data-annotation-new-note]' : '[data-annotation-edit-note], [data-annotation-new-note]')
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
    const positions = new Map(pageAnnotations.map((annotation, index) => [annotation.id, index + 1]));
    const annotations = pageAnnotations.filter((annotation) => annotation.selector === context.selector);

    shownVersion = versionOf(pageAnnotations, context.selector);
    restoredDraft = false;
    revokePreviewUrls();
    const promptFocused = discardPrompt?.element.contains((panel.getRootNode() as Document | ShadowRoot).activeElement) ?? false;
    const restoreFocus = keepPanelFocus(panel);
    panel.replaceChildren();
    const document = panel.ownerDocument;
    const header = document.createElement('header');
    header.dataset.annotationNoteHeader = '';
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';
    heading.tabIndex = -1;
    const hint = createElementHint(document, formatElementContext(context) ?? context.selector, context.selector);
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.annotationClose = '';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.addEventListener('click', () => panel.dispatchEvent(new Event(NOTE_PANEL_CLOSE_EVENT)));
    const firstNote = annotations[0];
    if (firstNote) {
      const number = document.createElement('span');
      number.dataset.annotationPosition = '';
      number.textContent = String(positions.get(firstNote.id));
      header.append(number);
    }
    header.append(heading, hint, close);
    panel.append(header);
    let status: HTMLParagraphElement | undefined;
    const showStatus = () => {
      announce(statusMessage ?? '');
      if (!statusMessage) return;
      if (!status) {
        status = document.createElement('p');
        status.dataset.annotationStatus = '';
      }
      status.textContent = statusMessage;
      if (!status.isConnected) panel.insertBefore(status, header.nextSibling);
    };
    showStatus();
    showCurrentStatus = showStatus;

    for (const annotation of annotations) {
      try {
        const item = await createAnnotationItem(document, annotation, positions.get(annotation.id)!, context, (error) => {
          if (selectedContext !== context) return;
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
    note.placeholder = 'What should change here?';
    const noteLabel = document.createElement('label');
    noteLabel.append('Add a note', note);
    const draftKey = newNoteDraftKey(context.url, context.selector);
    restoreDraft(note, draftKey);
    trackField(note, draftKey, (text) => !untouchedSeeds.has(draftKey) && text.trim() !== '');
    note.addEventListener('input', () => {
      untouchedSeeds.delete(draftKey);
      if (note.value.trim()) drafts.set(draftKey, note.value);
      else drafts.delete(draftKey);
    });
    const save = document.createElement('button');
    save.type = 'submit';
    save.dataset.annotationSave = '';
    if (annotations.length === 0) save.dataset.variant = 'primary';
    save.textContent = 'Add note';
    // aria-disabled, not disabled: a disabled button drops focus that the saved panel would return to its opener.
    if (pendingAdds.has(draftKey)) save.setAttribute('aria-disabled', 'true');
    const add = () => {
      if (pendingAdds.has(draftKey)) return;
      const value = note.value.trim();
      if (!value) {
        statusMessage = EMPTY_NOTE_MESSAGE;
        showStatus();
        return;
      }
      pendingAdds.add(draftKey);
      save.setAttribute('aria-disabled', 'true');
      void mutate({
        type: 'annotation.add',
        pageUrl: context.url,
        input: { note: value, selector: context.selector, elementContext: context },
      }, context, NOTE_SAVED_MESSAGE, true, [[draftKey, value]])
        .catch(() => undefined)
        .finally(() => {
          pendingAdds.delete(draftKey);
          // The form may have been rebuilt while the add was pending, so release the one shown now.
          if (showsNoteOf(context)) panel.querySelector('[data-annotation-save]')?.removeAttribute('aria-disabled');
        });
    };
    save.addEventListener('click', add);
    note.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      add();
    });
    const actions = document.createElement('div');
    actions.append(save);
    form.append(noteLabel, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.submitter !== save) add();
    });
    if (annotations.length > 0 && !drafts.has(draftKey) && expandedNewNote !== draftKey) {
      form.hidden = true;
      const addAnother = document.createElement('button');
      addAnother.type = 'button';
      addAnother.dataset.annotationAddAnother = '';
      addAnother.dataset.variant = 'quiet';
      addAnother.textContent = 'Add another note';
      addAnother.addEventListener('click', () => {
        expandedNewNote = draftKey;
        form.hidden = false;
        addAnother.hidden = true;
        note.focus();
      });
      panel.append(addAnother);
    }
    panel.append(form);
    restoreFocus();
    settleDiscardPrompt(promptFocused);
  }

  function showsNoteOf(context: ElementContext): boolean {
    return selectedContext?.url === context.url && selectedContext.selector === context.selector;
  }

  // sent pairs each draft key in the write with the text it carries.
  async function mutate(
    message: AnnotationWriteMessage,
    context: ElementContext,
    successMessage?: string,
    dismissOnSuccess = false,
    sent: Array<[string, string]> = [],
  ): Promise<void> {
    const sequence = renderSequence;
    const refusal = annotationWriteError(message);
    if (refusal) {
      statusMessage = refusal;
      showCurrentStatus();
      return;
    }
    await whileWriting(async () => {
      try {
        const result = await send(message, sent);
        const missing = (message.type === 'annotation.update' && result === null)
          || (message.type === 'annotation.delete' && result === false);
        if (!missing) dropDraft(message, sent);
        if (renderSequence !== sequence || !showsNoteOf(context)) return;
        statusMessage = missing ? DELETED_ELSEWHERE_MESSAGE : successMessage;
        await refresh(context);
        // Text typed after the save is still unsaved, so the note stays open for it.
        if (dismissOnSuccess && !missing && renderSequence === sequence && showsNoteOf(context) && !hasUnsavedDraft()) {
          panel.dispatchEvent(new Event(NOTE_PANEL_SAVED_EVENT));
          announce(NOTE_SAVED_MESSAGE);
        }
      } catch (error) {
        if (renderSequence !== sequence || !showsNoteOf(context)) return;
        statusMessage = errorMessage(error);
        await refresh(context);
      }
    });
  }

  // The sent text is in flight only until the send settles, so the re-read after it compares with storage.
  function send(message: AnnotationWriteMessage, sent: Array<[string, string]>): Promise<unknown> {
    const entries = sent.map(([key, text]) => ({ key, text }));
    inFlightText.push(...entries);
    syncUnsaved();
    return new Promise((resolve) => resolve(persistence.sendAnnotationWrite(message))).finally(() => {
      for (const entry of entries) inFlightText.splice(inFlightText.indexOf(entry), 1);
      syncUnsaved();
    });
  }

  function restoreDraft(field: HTMLTextAreaElement, key: string): boolean {
    const draft = drafts.get(key);
    if (draft === undefined) return false;
    field.value = draft;
    restoredDraft = true;
    return true;
  }

  function keepDraft(field: HTMLTextAreaElement, key: string): boolean {
    field.addEventListener('input', () => {
      if (field.value === field.defaultValue) drafts.delete(key);
      else drafts.set(key, field.value);
    });
    return restoreDraft(field, key);
  }

  function dropDraft(message: AnnotationWriteMessage, sent: Array<[string, string]>): void {
    if (message.type === 'annotation.clear') return;
    if (message.type === 'annotation.delete') {
      for (const field of EDIT_DRAFT_FIELDS) drafts.delete(editDraftKey(message.id, field));
      return;
    }
    // Text typed after the write started is not part of the save, so it stays.
    for (const [key, text] of sent) {
      if (drafts.get(key)?.trim() !== text.trim()) continue;
      drafts.delete(key);
      untouchedSeeds.delete(key);
    }
  }

  async function whileWriting(operation: () => Promise<void>): Promise<void> {
    pendingWrites += 1;
    try {
      await operation();
    } finally {
      pendingWrites -= 1;
    }
  }

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

  // A file or screenshot write can settle after the panel moved on. Its result is stored already, so only a panel still showing this note repaints.
  function settleWrite(context: ElementContext, failure?: string): Promise<void> {
    if (!showsNoteOf(context)) return Promise.resolve();
    statusMessage = failure;
    return refresh(context);
  }

  function reportFileError(error: unknown, context: ElementContext): void {
    void settleWrite(context, errorMessage(error)).catch((renderError) => {
      if (showsNoteOf(context)) statusMessage = errorMessage(renderError);
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
    item.dataset.annotationNoteCard = '';
    if (annotation.status === 'resolved') item.dataset.annotationStatus = 'resolved';
    const appliedCss = annotation.cssEdits && annotation.cssEdits.length > 0
      ? persistence.applyCssEdits(annotation, annotation.cssEdits)
      : undefined;
    const images = imagesSection(document, item, annotation, context, reportReadError);
    const css = cssSection(document, annotation, position, context, appliedCss?.refused);
    const repro = reproSection(document, annotation, position);
    // Text that repeats the stored value is not a change, so Save does not send it.
    const cssChange = (): CssDeclaration[] | undefined => {
      const declarations = css.pending();
      return declarations.length > 0 && !sameDeclarations(declarations, annotation.cssEdits) ? declarations : undefined;
    };
    const reproChange = (): Repro | undefined => {
      const change = repro.pending();
      return sameRepro(change, annotation.repro) ? undefined : change;
    };
    const note = noteSection(document, annotation, position, context, images.attachLabel, images.attachName, () => save());
    const hasCss = (annotation.cssEdits?.length ?? 0) > 0;

    function save(): void {
      // A blank note blocks the whole Save, so no CSS or repro change is applied or written without it.
      const value = note.field.value.trim();
      if (!value) {
        statusMessage = EMPTY_NOTE_MESSAGE;
        showCurrentStatus();
        return;
      }
      const changes: AnnotationUpdate = {};
      const sent: Array<[string, string]> = [];
      if (value !== annotation.note) {
        changes.note = value;
        sent.push([editDraftKey(annotation.id, 'note'), note.field.value]);
      }
      let successMessage: string | undefined;
      const declarations = cssChange();
      if (declarations) {
        const result = persistence.applyCssEdits(annotation, declarations);
        if (!result) {
          // A Save is not an image read, so it reports while the panel still shows this note, even during a same-note re-render.
          if (showsNoteOf(context)) {
            statusMessage = CSS_ELEMENT_NOT_FOUND_MESSAGE;
            showCurrentStatus();
          }
          return;
        }
        changes.cssEdits = result.edits;
        sent.push(css.sent());
        if (result.refused.length > 0) {
          successMessage = `Not applied because it would load a resource: ${result.refused.map(({ property }) => property).join(', ')}.`;
        }
      }
      const reproUpdate = reproChange();
      if (reproUpdate) {
        changes.repro = reproUpdate;
        sent.push(...repro.sent());
      }
      if (Object.keys(changes).length === 0) {
        statusMessage = NOTHING_TO_SAVE_MESSAGE;
        showCurrentStatus();
        return;
      }
      void mutate({ type: 'annotation.update', pageUrl: context.url, id: annotation.id, changes }, context, successMessage, true, sent);
    }

    item.append(
      note.field,
      note.media,
      group(document, annotation.id, 'css', 'CSS tweaks', hasCss, css.restored, [...css.controls, ...css.readout]),
      group(document, annotation.id, 'repro', 'Reproduction steps', annotation.repro !== undefined, repro.restored, [
        ...repro.controls,
        ...repro.readout,
      ]),
    );
    await images.appendPreviews();
    item.append(note.footer);
    markUnsaved(item);
    return item;
  }

  // A group starts open when it holds a restored draft, else when it has content unless the user left it the other way. Real browsers fire the
  // initial toggle event after the listener, so only a toggle that changes the shown state counts; a state that matches the content default is not stored.
  function group(
    document: Document,
    id: string,
    name: 'css' | 'repro',
    title: string,
    hasContent: boolean,
    restored: boolean,
    children: HTMLElement[],
  ): HTMLDetailsElement {
    const details = document.createElement('details');
    details.dataset[name === 'css' ? 'annotationCssGroup' : 'annotationReproGroup'] = '';
    const key = `${id} ${name}`;
    details.open = restored || (groupStates.get(key) ?? hasContent);
    let shown = details.open;
    details.addEventListener('toggle', () => {
      if (details.open === shown) return;
      shown = details.open;
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
    attachmentLabel: HTMLElement,
    attachmentName: HTMLElement,
    save: () => void,
  ): { field: HTMLTextAreaElement; media: HTMLElement; footer: HTMLElement } {
    const note = document.createElement('textarea');
    note.dataset.annotationEditNote = '';
    note.maxLength = MAX_TEXT_LENGTH;
    note.defaultValue = annotation.note;
    note.setAttribute('aria-label', `Edit note, annotation ${position}`);
    const draftKey = editDraftKey(annotation.id, 'note');
    restoreDraft(note, draftKey);
    trackField(note, draftKey, (text) => text.trim() !== annotation.note);
    const unsaved = document.createElement('p');
    unsaved.dataset.annotationUnsaved = '';
    unsaved.textContent = 'Unsaved changes';
    note.addEventListener('input', () => {
      if (note.value === annotation.note) drafts.delete(draftKey);
      else drafts.set(draftKey, note.value);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.annotationEdit = '';
    edit.textContent = 'Save';
    edit.addEventListener('click', save);
    note.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      save();
    });
    note.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => settleWrite(context),
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
    capture.dataset.variant = 'quiet';
    capture.textContent = 'Capture screenshot';
    capture.addEventListener('click', () => {
      void whileWriting(async () => {
        try {
          await persistence.captureScreenshot(annotation, context);
          await settleWrite(context);
        } catch (error) {
          await settleWrite(context, screenshotFailureMessage(error));
        }
      });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.dataset.variant = 'danger';
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
    edit.dataset.variant = 'primary';
    const media = document.createElement('div');
    media.dataset.annotationMediaActions = '';
    media.append(capture, attachmentLabel, attachmentName);
    const footer = document.createElement('div');
    footer.dataset.annotationNoteActions = '';
    footer.append(remove, unsaved, statusToggle, edit);
    return { field: note, media, footer };
  }

  function imagesSection(
    document: Document,
    item: HTMLElement,
    annotation: Annotation,
    context: ElementContext,
    reportReadError: (error: unknown) => void,
  ): { attachLabel: HTMLLabelElement; attachName: HTMLSpanElement; appendPreviews: () => Promise<void> } {
    const attachmentInput = document.createElement('input');
    attachmentInput.type = 'file';
    attachmentInput.accept = SUPPORTED_IMAGE_MIME_TYPES.join(',');
    attachmentInput.multiple = true;
    attachmentInput.dataset.annotationAttachmentInput = '';
    const attachmentLabel = document.createElement('label');
    attachmentLabel.dataset.annotationAttach = '';
    attachmentLabel.append('Attach image', attachmentInput);
    const attachmentName = document.createElement('span');
    attachmentName.dataset.annotationAttachName = '';
    attachmentInput.addEventListener('change', () => {
      const files = Array.from(attachmentInput.files ?? []);
      if (files.length === 0) return;
      attachmentName.textContent = files.map((file) => file.name).join(', ');
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => settleWrite(context),
        (error) => reportFileError(error, context),
      ));
      attachmentInput.value = '';
    });
    item.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void whileWriting(() => addFiles(annotation, context, files).then(
        () => settleWrite(context),
        (error) => reportFileError(error, context),
      ));
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
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
            }).then(() => settleWrite(context), (error) => reportFileError(error, context)));
          });
          wrapper.append(caption, removeAttachment);
          item.append(wrapper);
        } catch (error) {
          reportReadError(error);
        }
      }
    };
    return { attachLabel: attachmentLabel, attachName: attachmentName, appendPreviews };
  }

  function cssSection(
    document: Document,
    annotation: Annotation,
    position: number,
    context: ElementContext,
    refused: CssDeclaration[] = [],
  ): { controls: HTMLElement[]; readout: HTMLElement[]; restored: boolean; pending: () => CssDeclaration[]; sent: () => [string, string] } {
    const { field: cssDecls, label: cssDeclsLabel } = labelledField(
      document,
      position,
      'CSS declarations',
      annotation.cssEdits?.map(({ property, value }) => `${property}: ${value}`).join('\n') ?? '',
    );
    cssDecls.dataset.annotationCssDecls = '';
    const cssKey = editDraftKey(annotation.id, 'css');
    const restored = keepDraft(cssDecls, cssKey);
    trackField(cssDecls, cssKey, (text) => cssUnsaved(text, annotation.cssEdits));
    const pending = () => cssDecls.value === cssDecls.defaultValue ? [] : parseCssDeclarations(cssDecls.value);
    const sent = (): [string, string] => [cssKey, cssDecls.value];
    if (!annotation.cssEdits || annotation.cssEdits.length === 0) {
      return { controls: [cssDeclsLabel], readout: [], restored, pending, sent };
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
        undefined,
        false,
        [sent()],
      );
    });
    const readout = document.createElement('ul');
    readout.dataset.annotationCss = '';
    for (const { property, value, original } of annotation.cssEdits) {
      const entry = document.createElement('li');
      const isRefused = refused.some((declaration) => declaration.property === property && declaration.value === value);
      entry.textContent = `${property}: ${original} -> ${value}${isRefused ? ' (not applied: it would load a resource)' : ''}`;
      readout.append(entry);
    }
    const actions = groupActions(document, [clearCss]);
    return { controls: [cssDeclsLabel, actions], readout: [readout], restored, pending, sent };
  }

  function reproSection(
    document: Document,
    annotation: Annotation,
    position: number,
  ): { controls: HTMLElement[]; readout: HTMLElement[]; restored: boolean; pending: () => Repro | undefined; sent: () => Array<[string, string]> } {
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
    const stepsKey = editDraftKey(annotation.id, 'steps');
    const expectedKey = editDraftKey(annotation.id, 'expected');
    const actualKey = editDraftKey(annotation.id, 'actual');
    const restoredFields = [
      keepDraft(reproSteps, stepsKey),
      keepDraft(reproExpected, expectedKey),
      keepDraft(reproActual, actualKey),
    ];
    const restored = restoredFields.includes(true);
    const stored = annotation.repro;
    trackField(reproSteps, stepsKey, (text) => !sameSteps(stepsOf(text), stored?.steps ?? []));
    trackField(reproExpected, expectedKey, (text) => text.trim() !== (stored?.expected ?? ''));
    trackField(reproActual, actualKey, (text) => text.trim() !== (stored?.actual ?? ''));
    const pending = (): Repro | undefined => {
      if (![reproSteps, reproExpected, reproActual].some((field) => field.value !== field.defaultValue)) return undefined;
      const steps = stepsOf(reproSteps.value);
      const expected = reproExpected.value.trim();
      const actual = reproActual.value.trim();
      return steps.length === 0 && !expected && !actual ? undefined : { steps, expected, actual };
    };
    const sent = (): Array<[string, string]> => [
      [stepsKey, reproSteps.value],
      [expectedKey, reproExpected.value],
      [actualKey, reproActual.value],
    ];
    const controls = [reproStepsLabel, reproExpectedLabel, reproActualLabel];
    if (!annotation.repro) return { controls, readout: [], restored, pending, sent };
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
    return { controls, readout: [readout], restored, pending, sent };
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

  // The unsaved check of a field. A write in flight counts the text it sent as committed; otherwise the text is compared with storage.
  function trackField(field: HTMLTextAreaElement, key: string, unsavedAgainstStored: (text: string) => boolean): void {
    fieldStates.set(field, {
      key,
      unsaved: () => {
        const sent = inFlightText.filter((entry) => entry.key === key).at(-1)?.text;
        return sent === undefined ? unsavedAgainstStored(field.value) : field.value.trim() !== sent.trim();
      },
    });
  }

  function unsavedFieldsIn(root: ParentNode): HTMLTextAreaElement[] {
    return Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea')).filter((field) => fieldStates.get(field)?.unsaved());
  }

  // Typed text that a save would keep, or that Save ignores: a new note that is not an untouched seed, or a field that differs from its committed text.
  function hasUnsavedDraft(): boolean {
    return selectedContext !== undefined && unsavedFieldsIn(panel).length > 0;
  }

  function markUnsaved(card: HTMLElement): void {
    const marker = card.querySelector<HTMLElement>('[data-annotation-unsaved]');
    if (marker) marker.hidden = unsavedFieldsIn(card).length === 0;
  }

  function syncUnsaved(): void {
    for (const card of panel.querySelectorAll<HTMLElement>('[data-annotation-note-card]')) markUnsaved(card);
  }

  // Discard deletes only the unsaved text; text an add or update is already writing stays.
  function discardDrafts(): void {
    for (const field of unsavedFieldsIn(panel)) {
      const { key } = fieldStates.get(field)!;
      drafts.delete(key);
      untouchedSeeds.delete(key);
    }
  }

  // A refresh rebuilds the panel, so an open prompt is put back while its text is unsaved. Once nothing is unsaved, the outside click completes.
  function settleDiscardPrompt(keepFocus: boolean): void {
    if (!discardPrompt) return;
    const { element, onDiscard } = discardPrompt;
    if (!hasUnsavedDraft()) {
      discardPrompt = undefined;
      onDiscard();
      return;
    }
    panel.querySelector('[data-annotation-note-header]')?.after(element);
    if (keepFocus) element.querySelector<HTMLButtonElement>('button')?.focus();
  }

  // Inline prompt for an outside click on unsaved text. Keep (and Escape) leaves the panel and its drafts; Discard deletes them, then calls onDiscard.
  function confirmDiscard(onDiscard: () => void): void {
    const header = panel.querySelector('[data-annotation-note-header]');
    if (!header || discardPrompt) return;
    const document = panel.ownerDocument;
    const prompt = document.createElement('div');
    prompt.dataset.annotationDiscardPrompt = '';
    prompt.setAttribute('role', 'group');
    prompt.setAttribute('aria-label', 'Unsaved changes');
    const question = document.createElement('p');
    question.textContent = 'Discard unsaved changes?';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = 'Keep';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.dataset.variant = 'danger';
    discard.textContent = 'Discard';
    keep.addEventListener('click', () => {
      prompt.remove();
      discardPrompt = undefined;
      (unsavedFieldsIn(panel)[0] ?? panel.querySelector<HTMLTextAreaElement>('[data-annotation-new-note]'))?.focus();
    });
    discard.addEventListener('click', () => {
      discardPrompt = undefined;
      discardDrafts();
      onDiscard();
    });
    prompt.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Escape answers the prompt with Keep; it must not also close the panel.
      event.stopPropagation();
      keep.click();
    });
    prompt.append(question, keep, discard);
    discardPrompt = { element: prompt, onDiscard };
    header.after(prompt);
    keep.focus();
  }

  function clear(): void {
    renderSequence++;
    selectedContext = undefined;
    discardPrompt = undefined;
    statusMessage = undefined;
    expandedNewNote = undefined;
    revokePreviewUrls();
    panel.replaceChildren();
    announce('');
  }

  function teardown(): void {
    drafts.clear();
    untouchedSeeds.clear();
    revokePreviewUrls();
    persistence.revertAllCssEdits();
  }

  return { render, clear, teardown, syncWithStorage, hasUnsavedDraft, confirmDiscard, live };
}

function newNoteDraftKey(url: string, selector: string): string {
  return `new ${url} ${selector}`;
}

type EditDraftField = 'note' | 'css' | 'steps' | 'expected' | 'actual';
const REPRO_DRAFT_FIELDS: EditDraftField[] = ['steps', 'expected', 'actual'];
const EDIT_DRAFT_FIELDS: EditDraftField[] = ['note', 'css', ...REPRO_DRAFT_FIELDS];

function editDraftKey(id: string, field: EditDraftField): string {
  return `edit ${id} ${field}`;
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

function groupActions(document: Document, controls: HTMLElement[]): HTMLElement {
  const actions = document.createElement('div');
  actions.dataset.annotationGroupActions = '';
  actions.append(...controls);
  return actions;
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

// Text is unsaved when its declarations differ from the stored ones, or when a line is not a declaration at all (Save ignores that line).
function cssUnsaved(text: string, stored: CssDeclaration[] = []): boolean {
  return !sameDeclarations(parseCssDeclarations(text), stored)
    || text.split(/\r?\n/).some((line) => line.trim() !== '' && parseCssDeclarations(line).length === 0);
}

function sameDeclarations(declarations: CssDeclaration[], stored: CssDeclaration[] = []): boolean {
  return declarations.length === stored.length
    && declarations.every(({ property, value }, index) => property === stored[index]!.property && value === stored[index]!.value);
}

function stepsOf(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
}

function sameSteps(steps: string[], stored: string[]): boolean {
  return steps.length === stored.length && steps.every((step, index) => step === stored[index]);
}

function sameRepro(repro: Repro | undefined, stored: Repro | undefined): boolean {
  if (!repro || !stored) return repro === stored;
  return repro.expected === stored.expected && repro.actual === stored.actual && sameSteps(repro.steps, stored.steps);
}
