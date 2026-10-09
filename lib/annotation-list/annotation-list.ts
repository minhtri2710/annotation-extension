import type { Annotation } from '../annotation';
import { errorMessage } from '../guards';
import { annotationAssets, format, formatElementContext } from '../export/format';
import { formatPageHtml } from '../export/html';
import {
  productionExportDelivery,
  type AnnotationExportDelivery,
} from '../export/delivery';
import { listAnnotations } from '../annotation-storage';
import { sendAnnotationWrite, type AnnotationWriteMessage } from '../annotation-messages';
import { sendBlobRead } from '../screenshot/messages';
import { readOnboardingOpen, writeOnboardingOpen } from '../ui/ui-prefs';
import { resolveSelector } from '../capture/selector';
import { CAPTURE_SHORTCUT_UNSET_HINT, readCaptureShortcut, SHORTCUT_SETTINGS } from '../capture/activation';
import { createLocateHighlight } from '../ui/locate-highlight';
import { createElementHint } from '../ui/element-hint';
import { setIconButton } from '../ui/icons';
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

export const ANNOTATION_EDIT_EVENT = 'annotation-edit';
export const ANNOTATION_START_EVENT = 'annotation-start';
export const ANNOTATION_LIST_CLOSE_EVENT = 'annotation-list-close';
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

function onboardingSteps(shortcut: string | undefined): string[] {
  const first = shortcut === undefined
    ? `Click Annotate, then click any element to leave a note. You can set a keyboard shortcut in ${SHORTCUT_SETTINGS}.`
    : shortcut === ''
      ? `Click Annotate, then click any element to leave a note. ${CAPTURE_SHORTCUT_UNSET_HINT}`
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
      persistence.readOnboardingOpen().catch(() => false),
      persistence.readCaptureShortcut().catch(() => undefined),
    ]);
    if (version !== renderVersion) return;

    const document = panel.ownerDocument;
    const restoreFocus = keepPanelFocus(panel);
    panel.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'All annotations';
    heading.tabIndex = -1;
    const onboarding = createOnboarding(document, onboardingOpen, shortcut);
    panel.append(createHeader(document, heading, annotations.length, onboarding));
    document.addEventListener('visibilitychange', refreshShortcut);
    document.defaultView?.addEventListener('focus', refreshShortcut);
    announce(statusMessage ?? '');
    if (statusMessage) {
      const status = document.createElement('p');
      status.dataset.annotationStatus = '';
      status.textContent = statusMessage;
      panel.append(status);
    }
    panel.append(onboarding);

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
      const rows = document.createElement('div');
      rows.dataset.annotationRows = '';
      annotations.forEach((annotation, index) => rows.append(createRow(document, annotation, index + 1)));
      panel.append(
        createStatusFilter(document, annotations, rows),
        rows,
        createFooter(document, annotations),
      );
    }
    restoreFocus();
  }

  function createHeader(document: Document, heading: HTMLElement, count: number, onboarding: HTMLElement): HTMLElement {
    const header = document.createElement('header');
    header.dataset.annotationListHeader = '';
    const total = document.createElement('span');
    total.dataset.annotationListCount = '';
    total.textContent = String(count);
    const help = document.createElement('button');
    help.type = 'button';
    help.dataset.annotationHelp = '';
    help.dataset.variant = 'quiet';
    help.textContent = '?';
    help.setAttribute('aria-label', 'How it works');
    help.title = 'How it works';
    help.setAttribute('aria-expanded', String(!onboarding.hidden));
    help.addEventListener('click', () => {
      onboarding.hidden = !onboarding.hidden;
      help.setAttribute('aria-expanded', String(!onboarding.hidden));
      void persistence.writeOnboardingOpen(!onboarding.hidden).catch(() => undefined);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.annotationClose = '';
    close.dataset.variant = 'quiet';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.addEventListener('click', () => panel.dispatchEvent(new Event(ANNOTATION_LIST_CLOSE_EVENT)));
    header.append(heading, total, help, close);
    return header;
  }

  function refreshShortcut(): void {
    if (panel.ownerDocument.visibilityState !== 'visible') return;
    const version = renderVersion;
    void persistence.readCaptureShortcut().catch(() => undefined).then((shortcut) => {
      if (version !== renderVersion) return;
      const step = panel.querySelector('[data-annotation-onboarding] ol > li');
      if (step) step.textContent = onboardingSteps(shortcut)[0]!;
    });
  }

  function createFooter(document: Document, annotations: Annotation[]): HTMLDivElement {
    const footer = document.createElement('div');
    footer.dataset.annotationListFooter = '';
    footer.append(createExportSection(document, annotations), createClearAll(document, annotations.length));
    return footer;
  }

  function createClearAll(document: Document, count: number): HTMLButtonElement {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.annotationClear = '';
    clear.dataset.variant = 'danger';
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
    const section = document.createElement('section');
    section.dataset.annotationOnboarding = '';
    section.hidden = !open;
    const steps = document.createElement('ol');
    for (const step of onboardingSteps(shortcut)) {
      const item = document.createElement('li');
      item.textContent = step;
      steps.append(item);
    }
    section.append(steps);
    return section;
  }

  function createExportSection(document: Document, annotations: Annotation[]): HTMLElement {
    const section = document.createElement('section');
    section.dataset.annotationExport = '';

    const markdown = () => format(annotations, pageUrl);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.dataset.annotationExportCopy = '';
    copy.textContent = 'Copy Markdown';
    copy.addEventListener('click', () => {
      const version = clearVersion;
      const text = markdown();
      const pending = formatPageHtml(pageUrl, annotations, (key) => persistence.readBlob(key)).then((html) => ({ text, html }));
      // A copy may not consume the payload on every path, so its rejection is marked handled here; copy still reports it.
      pending.catch(() => undefined);
      void (async () => {
        let message = 'Copied to clipboard.';
        try {
          await delivery.copy(pending);
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
    download.dataset.variant = 'quiet';
    download.textContent = 'Download';
    download.setAttribute('aria-label', 'Download Markdown');
    download.addEventListener('click', () => {
      const version = clearVersion;
      void (async () => {
        try {
          delivery.download(markdown(), 'annotations.md');
        } catch (error) {
          if (version !== clearVersion) return;
          statusMessage = errorMessage(error);
          await render();
          return;
        }
        let images = 0;
        try {
          for (const annotation of annotations) {
            for (const { key, filename } of annotationAssets(annotation)) {
              delivery.downloadAsset(await persistence.readBlob(key), filename);
              images += 1;
            }
          }
        } catch (error) {
          if (version !== clearVersion) return;
          statusMessage = `Download started for annotations.md, but an image could not be read: ${errorMessage(error)}`;
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

    const actions = document.createElement('div');
    actions.dataset.annotationExportActions = '';
    actions.append(copy, download);
    section.append(actions);
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

    const hint = createElementHint(document, formatElementContext(annotation.elementContext) ?? annotation.selector, annotation.selector);

    const status = document.createElement('p');
    status.dataset.annotationStatus = annotation.status;
    status.textContent = annotation.status === 'open' ? 'Open' : 'Resolved';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.dataset.variant = 'danger';
    setIconButton(remove, 'trash', `Delete annotation ${position}`);
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
    locate.dataset.variant = 'quiet';
    setIconButton(locate, 'locate', `Locate annotation ${position}`);
    locate.addEventListener('click', () => {
      const element = resolveSelector(document, annotation.selector);
      if (element) {
        row.querySelector('[data-annotation-locate-missing]')?.remove();
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
    edit.dataset.variant = 'quiet';
    setIconButton(edit, 'edit', `Edit annotation ${position}`);
    edit.addEventListener('click', () => {
      panel.dispatchEvent(new CustomEvent<Annotation>(ANNOTATION_EDIT_EVENT, { detail: annotation }));
    });

    const actions = document.createElement('div');
    actions.dataset.annotationRowActions = '';
    actions.append(locate, edit, remove);
    row.append(number, note, actions, hint, status);
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
    panel.ownerDocument.defaultView?.removeEventListener('focus', refreshShortcut);
    panel.replaceChildren();
    announce('');
  }

  return { render, clear, live };
}
