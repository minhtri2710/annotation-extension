import type { Annotation } from '../annotation';
import { format, screenshotAssetFilename } from '../export/format';
import {
  productionExportDelivery,
  type AnnotationExportDelivery,
} from '../export/delivery';
import { listAnnotations } from '../annotation-storage';
import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { sendScreenshotRead } from '../screenshot/messages';

export interface AnnotationListPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  readScreenshot(annotationId: string): Promise<Blob>;
}

export interface AnnotationList {
  render(): Promise<void>;
  clear(): void;
}

const productionPersistence: AnnotationListPersistence = { listAnnotations, sendAnnotationWrite, readScreenshot: sendScreenshotRead };

export function createAnnotationList(
  panel: HTMLElement,
  pageUrl: string,
  persistence: AnnotationListPersistence = productionPersistence,
  delivery: AnnotationExportDelivery = productionExportDelivery,
): AnnotationList {
  let renderVersion = 0;
  let statusMessage: string | undefined;

  async function render(): Promise<void> {
    const version = ++renderVersion;
    const annotations = await persistence.listAnnotations(pageUrl);
    if (version !== renderVersion) return;

    const document = panel.ownerDocument;
    panel.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'All annotations';
    panel.append(heading);
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
      void (async () => {
        try {
          delivery.download(markdown(), 'annotations.md');
          for (const annotation of annotations) {
            if (!annotation.screenshot) continue;
            const blob = await persistence.readScreenshot(annotation.id);
            delivery.downloadAsset(
              blob,
              screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType),
            );
          }
        } catch (error) {
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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.setAttribute('aria-label', `Delete annotation ${annotation.id}`);
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      void mutate({ type: 'annotation.delete', pageUrl, id: annotation.id });
    });

    row.append(note, hint, remove);
    return row;
  }

  async function mutate(message: AnnotationWriteMessage): Promise<void> {
    try {
      await persistence.sendAnnotationWrite(message);
      statusMessage = undefined;
      await render();
    } catch (error) {
      statusMessage = errorMessage(error);
      await render();
    }
  }

  function clear(): void {
    renderVersion += 1;
    panel.replaceChildren();
  }

  return { render, clear };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
