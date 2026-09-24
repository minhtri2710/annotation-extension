import type { Annotation } from '../annotation';
import { errorMessage } from '../guards';
import { annotationAssets, format, formatElementContext } from '../export/format';
import {
  productionExportDelivery,
  type AnnotationExportDelivery,
} from '../export/delivery';
import { listAnnotations } from '../annotation-storage';
import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { sendBlobRead } from '../screenshot/messages';
import { readOnboardingOpen, writeOnboardingOpen } from '../ui/ui-prefs';
import { resolveSelector } from '../capture/selector';
import { captureShortcutHint, readCaptureShortcut, SHORTCUT_SETTINGS } from '../capture/activation';
import { createLocateHighlight } from '../ui/locate-highlight';
import { createInlineConfirm, createLiveRegion, keepPanelFocus } from '../ui/shell';

export interface AnnotationListPersistence {
  listAnnotations(pageUrl: string): Promise<Annotation[]>;
  sendAnnotationWrite(message: AnnotationWriteMessage): Promise<unknown>;
  readBlob(key: string): Promise<Blob>;
  readOnboardingOpen(): Promise<boolean>;
  readCaptureShortcut(): Promise<string>;
  writeOnboardingOpen(open: boolean): Promise<void>;
}

export interface AnnotationList {
  render(): Promise<void>;
  clear(): void;
  live: HTMLElement;
}

// Dispatched on the panel mount with the annotation as detail when a row's Edit is clicked.
export const ANNOTATION_EDIT_EVENT = 'annotation-edit';
// Dispatched on the panel mount when the empty list's Start annotating is clicked.
export const ANNOTATION_START_EVENT = 'annotation-start';
const LOCATE_MISSING_MESSAGE = 'Element not found on this page';

type StatusFilter = 'all' | Annotation['status'];
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'open', 'resolved'];
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { all: 'All', open: 'Open', resolved: 'Resolved' };

const productionPersistence: AnnotationListPersistence = {
  listAnnotations,
  sendAnnotationWrite,
  readBlob: sendBlobRead,
  readOnboardingOpen,
  readCaptureShortcut,
  writeOnboardingOpen,
};

// undefined means the shortcut could not be read.
function onboardingSteps(shortcut: string | undefined): string[] {
  const first = shortcut === undefined
    ? `Click Annotate, then click any element to leave a note. You can set a keyboard shortcut in ${SHORTCUT_SETTINGS}.`
    : shortcut === ''
      ? `Click Annotate, then click any element to leave a note. ${captureShortcutHint('')}`
      : `Click Annotate or press ${shortcut}, then click any element to leave a note.`;
  return [first, ...LATER_ONBOARDING_STEPS];
}

const LATER_ONBOARDING_STEPS = [
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
  let statusFilter: StatusFilter = 'all';
  const highlight = createLocateHighlight();
  const { element: live, announce } = createLiveRegion(panel.ownerDocument);

  async function render(): Promise<void> {
    const version = ++renderVersion;
    let annotations: Annotation[] = [];
    try {
      annotations = await persistence.listAnnotations(pageUrl);
    } catch (error) {
      if (version !== renderVersion) return;
      statusMessage = errorMessage(error);
    }
    const [onboardingOpen, shortcut] = await Promise.all([
      persistence.readOnboardingOpen().catch(() => true),
      persistence.readCaptureShortcut().catch(() => undefined),
    ]);
    if (version !== renderVersion) return;

    const document = panel.ownerDocument;
    const restoreFocus = keepPanelFocus(panel);
    panel.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'All annotations';
    heading.tabIndex = -1;
    panel.append(heading, createOnboarding(document, onboardingOpen, shortcut));
    document.addEventListener('visibilitychange', refreshShortcut);
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
      const start = document.createElement('button');
      start.type = 'button';
      start.dataset.annotationStart = '';
      start.textContent = 'Start annotating';
      start.addEventListener('click', () => panel.dispatchEvent(new CustomEvent(ANNOTATION_START_EVENT)));
      panel.append(empty, start);
    } else {
      panel.append(createClearAll(document, annotations.length), createExportSection(document, annotations));
      const rows = document.createElement('div');
      rows.dataset.annotationRows = '';
      annotations.forEach((annotation, index) => rows.append(createRow(document, annotation, index + 1)));
      panel.append(createStatusFilter(document, annotations, rows), rows);
    }
    restoreFocus();
  }

  // Coming back from the browser's shortcut settings updates only the first step, so the rest of the list keeps its state.
  function refreshShortcut(): void {
    if (panel.ownerDocument.visibilityState !== 'visible') return;
    const version = renderVersion;
    void persistence.readCaptureShortcut().catch(() => undefined).then((shortcut) => {
      if (version !== renderVersion) return;
      const step = panel.querySelector('[data-annotation-onboarding] ol > li');
      if (step) step.textContent = onboardingSteps(shortcut)[0]!;
    });
  }

  // Clear all deletes nothing by itself; it swaps in an inline prompt, and only its Delete all clears.
  function createClearAll(document: Document, count: number): HTMLButtonElement {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.annotationClear = '';
    clear.textContent = 'Clear all';
    createInlineConfirm(document, {
      trigger: clear,
      question: `Delete all ${count} ${count === 1 ? 'annotation' : 'annotations'} on this page? This cannot be undone.`,
      confirmLabel: 'Delete all',
      ariaLabel: 'Confirm clear all',
      onConfirm: () => void mutate({ type: 'annotation.clear', pageUrl }),
      dataPrefix: 'annotation-clear',
    });
    return clear;
  }

  // Filtering hides rows in place, so rows keep their pin numbers and the pressed chip keeps focus.
  function createStatusFilter(document: Document, annotations: Annotation[], rows: HTMLElement): DocumentFragment {
    const group = document.createElement('div');
    group.dataset.annotationFilter = '';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Filter by status');
    const empty = document.createElement('p');
    empty.dataset.annotationFilterEmpty = '';

    const chips = STATUS_FILTERS.map((value) => {
      const count = value === 'all' ? annotations.length : annotations.filter((annotation) => annotation.status === value).length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.annotationFilterValue = value;
      chip.textContent = `${STATUS_FILTER_LABELS[value]} (${count})`;
      chip.addEventListener('click', () => {
        statusFilter = value;
        apply();
        announce(`Showing ${value} annotations`);
      });
      return chip;
    });
    group.append(...chips);

    function apply(): void {
      for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.annotationFilterValue === statusFilter));
      annotations.forEach((annotation, index) => {
        (rows.children[index] as HTMLElement).hidden = statusFilter !== 'all' && annotation.status !== statusFilter;
      });
      empty.hidden = statusFilter === 'all' || annotations.some((annotation) => annotation.status === statusFilter);
      empty.textContent = empty.hidden ? '' : `No ${statusFilter} annotations.`;
    }

    apply();
    const fragment = document.createDocumentFragment();
    fragment.append(group, empty);
    return fragment;
  }

  function createOnboarding(document: Document, open: boolean, shortcut: string | undefined): HTMLElement {
    const details = document.createElement('details');
    details.dataset.annotationOnboarding = '';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = 'How it works';
    const steps = document.createElement('ol');
    for (const step of onboardingSteps(shortcut)) {
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
    copy.textContent = 'Copy Markdown';
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
    download.textContent = 'Download Markdown';
    download.addEventListener('click', () => {
      const version = clearVersion;
      void (async () => {
        let images = 0;
        try {
          delivery.download(markdown(), 'annotations.md');
          for (const annotation of annotations) {
            for (const { key, filename } of annotationAssets(annotation)) {
              delivery.downloadAsset(await persistence.readBlob(key), filename);
              images += 1;
            }
          }
        } catch (error) {
          if (version !== clearVersion) return;
          statusMessage = errorMessage(error);
          await render();
          return;
        }
        if (version !== clearVersion) return;
        statusMessage = images === 0
          ? 'Download started for annotations.md.'
          : `Download started for annotations.md and ${images} ${images === 1 ? 'image file' : 'image files'}.`;
        await render();
      })();
    });

    section.append(heading, copy, download);
    return section;
  }

  function createRow(document: Document, annotation: Annotation, position: number): HTMLElement {
    const row = document.createElement('article');
    row.dataset.annotationRow = '';
    row.dataset.annotationId = annotation.id;

    const number = document.createElement('span');
    number.dataset.annotationPosition = '';
    number.textContent = String(position);

    const note = document.createElement('p');
    note.dataset.annotationNote = '';
    note.textContent = annotation.note;

    const hint = document.createElement('p');
    hint.dataset.annotationHint = '';
    hint.textContent = formatElementContext(annotation.elementContext) ?? annotation.selector;
    hint.title = annotation.selector;

    const status = document.createElement('p');
    status.dataset.annotationStatus = annotation.status;
    status.textContent = annotation.status === 'open' ? 'Open' : 'Resolved';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.setAttribute('aria-label', `Delete annotation ${position}`);
    remove.textContent = 'Delete';
    const dismissDelete = createInlineConfirm(document, {
      trigger: remove,
      question: `Delete annotation ${position}? This cannot be undone.`,
      confirmLabel: 'Delete',
      ariaLabel: `Confirm delete annotation ${position}`,
      onConfirm: () => {
        dismissDelete();
        void mutate({ type: 'annotation.delete', pageUrl, id: annotation.id });
      },
      dataPrefix: 'annotation-delete',
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
        announce(`Annotation ${position} located.`);
        return;
      }
      flagMissing(document, row);
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

    row.append(number, note, hint, status, locate, edit, remove);
    if (!resolveSelector(document, annotation.selector)) flagMissing(document, row);
    return row;
  }

  function flagMissing(document: Document, row: HTMLElement): void {
    if (row.querySelector('[data-annotation-locate-missing]')) return;
    const missing = document.createElement('p');
    missing.dataset.annotationLocateMissing = '';
    missing.textContent = LOCATE_MISSING_MESSAGE;
    row.append(missing);
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
    panel.ownerDocument.removeEventListener('visibilitychange', refreshShortcut);
    panel.replaceChildren();
    announce('');
  }

  return { render, clear, live };
}
