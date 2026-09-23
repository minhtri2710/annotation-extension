import type { Annotation } from '../annotation';
import { attachmentAssetFilename, format, screenshotAssetFilename } from '../export/format';
import {
  productionExportDelivery,
  type AnnotationExportDelivery,
} from '../export/delivery';
import { listAnnotations } from '../annotation-storage';
import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { sendBlobRead } from '../screenshot/messages';
import { attachmentKey, screenshotKey } from '../blob-store';
import { readOnboardingOpen, writeOnboardingOpen } from '../ui/ui-prefs';
import { resolveSelector } from '../capture/selector';
import { createLocateHighlight } from '../ui/locate-highlight';
import { keepPanelFocus } from '../ui/shell';

export interface AnnotationListPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  readBlob(key: string): Promise<Blob>;
  readOnboardingOpen(): Promise<boolean>;
  writeOnboardingOpen(open: boolean): Promise<void>;
}

export interface AnnotationList {
  render(): Promise<void>;
  clear(): void;
  live: HTMLElement;
}

// Dispatched on the panel mount with the annotation as detail when a row's Edit is clicked.
export const ANNOTATION_EDIT_EVENT = 'annotation-edit';
const LOCATE_MISSING_MESSAGE = 'Element not found on this page';

const productionPersistence: AnnotationListPersistence = {
  listAnnotations,
  sendAnnotationWrite,
  readBlob: sendBlobRead,
  readOnboardingOpen,
  writeOnboardingOpen,
};

const ONBOARDING_STEPS = [
  'Click Annotate (default shortcut Ctrl+Shift+. ; Control+Shift+. on Mac), then click any element to leave a note.',
  'Pins mark annotated elements. Click a pin to reopen its note.',
  "View all lists this page's notes. Export them here, or export every page from the extension popup.",
  'Scan checks the page against design rules. Locate jumps to each finding.',
  'Press Esc to stop annotating.',
];

export function createAnnotationList(
  panel: HTMLElement,
  pageUrl: string,
  persistence: AnnotationListPersistence = productionPersistence,
  delivery: AnnotationExportDelivery = productionExportDelivery,
): AnnotationList {
  let renderVersion = 0;
  let clearVersion = 0;
  let statusMessage: string | undefined;
  const highlight = createLocateHighlight();
  const live = panel.ownerDocument.createElement('p');
  live.dataset.annotationLive = '';
  live.setAttribute('role', 'status');

  function announce(text: string): void {
    if (live.textContent !== text) live.textContent = text;
  }

  async function render(): Promise<void> {
    const version = ++renderVersion;
    let annotations: Annotation[] = [];
    try {
      annotations = await persistence.listAnnotations(pageUrl);
    } catch (error) {
      if (version !== renderVersion) return;
      statusMessage = errorMessage(error);
    }
    const onboardingOpen = await persistence.readOnboardingOpen().catch(() => true);
    if (version !== renderVersion) return;

    const document = panel.ownerDocument;
    const restoreFocus = keepPanelFocus(panel);
    panel.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'All annotations';
    heading.tabIndex = -1;
    panel.append(heading, createOnboarding(document, onboardingOpen));
    announce(statusMessage ?? '');
    if (statusMessage) {
      const status = document.createElement('p');
      status.dataset.annotationStatus = '';
      status.textContent = statusMessage;
      panel.append(status);
    }

    if (annotations.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.annotationEmptyState = '';
      empty.textContent = 'No annotations on this page.';
      panel.append(empty);
    } else {
      panel.append(createClearAll(document, annotations.length), createExportSection(document, annotations));
      const rows = document.createElement('div');
      rows.dataset.annotationRows = '';
      annotations.forEach((annotation, index) => rows.append(createRow(document, annotation, index + 1)));
      panel.append(rows);
    }
    restoreFocus();
  }

  // Clear all deletes nothing by itself; it swaps in an inline prompt, and only its Delete all clears.
  function createClearAll(document: Document, count: number): HTMLButtonElement {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.annotationClear = '';
    clear.textContent = 'Clear all';

    const prompt = document.createElement('div');
    prompt.dataset.annotationClearPrompt = '';
    prompt.setAttribute('role', 'group');
    const question = document.createElement('p');
    question.textContent = `Delete all ${count} ${count === 1 ? 'annotation' : 'annotations'} on this page? This cannot be undone.`;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.dataset.annotationClearConfirm = '';
    confirm.textContent = 'Delete all';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.annotationClearCancel = '';
    cancel.textContent = 'Cancel';
    prompt.setAttribute('aria-label', 'Confirm clear all');
    prompt.append(question, confirm, cancel);

    const dismiss = () => {
      prompt.replaceWith(clear);
      clear.focus();
    };
    clear.addEventListener('click', () => {
      clear.replaceWith(prompt);
      cancel.focus();
    });
    confirm.addEventListener('click', () => {
      void mutate({ type: 'annotation.clear', pageUrl });
    });
    cancel.addEventListener('click', dismiss);
    prompt.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Escape here dismisses the prompt only; it must not also close the panel.
      event.stopPropagation();
      dismiss();
    });
    return clear;
  }

  function createOnboarding(document: Document, open: boolean): HTMLElement {
    const details = document.createElement('details');
    details.dataset.annotationOnboarding = '';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = 'How it works';
    const steps = document.createElement('ol');
    for (const step of ONBOARDING_STEPS) {
      const item = document.createElement('li');
      item.textContent = step;
      steps.append(item);
    }
    details.append(summary, steps);
    details.addEventListener('toggle', () => {
      void persistence.writeOnboardingOpen(details.open).catch(() => undefined);
    });
    return details;
  }

  function createExportSection(document: Document, annotations: Annotation[]): HTMLElement {
    const section = document.createElement('section');
    section.dataset.annotationExport = '';

    const heading = document.createElement('h3');
    heading.textContent = 'Export';

    const markdown = () => format(annotations, pageUrl);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.dataset.annotationExportCopy = '';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      const version = clearVersion;
      void (async () => {
        let message = 'Copied to clipboard.';
        try {
          await delivery.copy(markdown());
        } catch (error) {
          message = `Copy failed: ${errorMessage(error)}`;
        }
        if (version !== clearVersion) return;
        statusMessage = message;
        await render();
      })();
    });

    const download = document.createElement('button');
    download.type = 'button';
    download.dataset.annotationExportDownload = '';
    download.textContent = 'Download';
    download.addEventListener('click', () => {
      const version = clearVersion;
      void (async () => {
        try {
          delivery.download(markdown(), 'annotations.md');
          for (const annotation of annotations) {
            if (annotation.screenshot) {
              const blob = await persistence.readBlob(screenshotKey(annotation.id));
              delivery.downloadAsset(
                blob,
                screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType),
              );
            }
            for (const [attachmentIndex, attachment] of (annotation.attachments ?? []).entries()) {
              const attachmentBlob = await persistence.readBlob(attachmentKey(attachment.id));
              delivery.downloadAsset(
                attachmentBlob,
                attachmentAssetFilename(annotation.id, attachmentIndex, attachment.mimeType),
              );
            }
          }
        } catch (error) {
          if (version !== clearVersion) return;
          statusMessage = errorMessage(error);
          await render();
        }
      })();
    });

    section.append(heading, copy, download);
    return section;
  }

  function createRow(document: Document, annotation: Annotation, position: number): HTMLElement {
    const row = document.createElement('article');
    row.dataset.annotationRow = '';
    row.dataset.annotationId = annotation.id;

    const note = document.createElement('p');
    note.dataset.annotationNote = '';
    note.textContent = annotation.note;

    const hint = document.createElement('p');
    hint.dataset.annotationHint = '';
    hint.textContent = annotation.selector;

    const status = document.createElement('p');
    status.dataset.annotationStatus = annotation.status;
    status.textContent = `Status: ${annotation.status}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.setAttribute('aria-label', `Delete annotation ${annotation.id}`);
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      void mutate({ type: 'annotation.delete', pageUrl, id: annotation.id });
    });

    const locate = document.createElement('button');
    locate.type = 'button';
    locate.dataset.annotationLocate = '';
    locate.setAttribute('aria-label', `Locate annotation ${position}`);
    locate.textContent = 'Locate';
    locate.addEventListener('click', () => {
      const element = resolveSelector(document, annotation.selector);
      if (element) {
        row.querySelector('[data-annotation-locate-missing]')?.remove();
        // The panel mount sits in the shell root, the same root the scan panel highlights into.
        highlight.show(panel.parentElement!, element);
        return;
      }
      if (!row.querySelector('[data-annotation-locate-missing]')) {
        const missing = document.createElement('p');
        missing.dataset.annotationLocateMissing = '';
        missing.textContent = LOCATE_MISSING_MESSAGE;
        row.append(missing);
      }
      announce(LOCATE_MISSING_MESSAGE);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.annotationRowEdit = '';
    edit.setAttribute('aria-label', `Edit annotation ${position}`);
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      panel.dispatchEvent(new CustomEvent<Annotation>(ANNOTATION_EDIT_EVENT, { detail: annotation }));
    });

    row.append(note, hint, status, locate, edit, remove);
    return row;
  }

  // An action re-renders only if clear() did not run while it was pending.
  async function mutate(message: AnnotationWriteMessage): Promise<void> {
    const version = clearVersion;
    try {
      await persistence.sendAnnotationWrite(message);
      if (version !== clearVersion) return;
      statusMessage = undefined;
      await render();
    } catch (error) {
      if (version !== clearVersion) return;
      statusMessage = errorMessage(error);
      await render();
    }
  }

  function clear(): void {
    clearVersion += 1;
    renderVersion += 1;
    statusMessage = undefined;
    highlight.remove();
    panel.replaceChildren();
    announce('');
  }

  return { render, clear, live };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
