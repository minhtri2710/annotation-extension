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
}

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
    panel.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'All annotations';
    panel.append(heading, createOnboarding(document, onboardingOpen));
    if (statusMessage) {
      const status = document.createElement('p');
      status.dataset.annotationStatus = '';
      status.textContent = statusMessage;
      panel.append(status);
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.annotationClear = '';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => {
      void mutate({ type: 'annotation.clear', pageUrl });
    });
    panel.append(clear);

    if (annotations.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.annotationEmptyState = '';
      empty.textContent = 'No annotations on this page.';
      panel.append(empty);
      return;
    }

    panel.append(createExportSection(document, annotations));

    const rows = document.createElement('div');
    rows.dataset.annotationRows = '';
    for (const annotation of annotations) rows.append(createRow(document, annotation));
    panel.append(rows);
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
      void delivery.copy(markdown()).catch(() => undefined);
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

  function createRow(document: Document, annotation: Annotation): HTMLElement {
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

    row.append(note, hint, status, remove);
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
    panel.replaceChildren();
  }

  return { render, clear };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
