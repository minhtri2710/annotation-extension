import { collectFindings, createScanContext, type Finding, type Rule, type Severity } from '../lint/engine';
import { ALL_RULES, DEEP_SCAN_RULES } from '../lint/rules';
import { revealSweep } from './reveal-sweep';
import { errorMessage } from '../guards';
import { createLocateHighlight } from '../ui/locate-highlight';
import { createLiveRegion } from '../ui/shell';

export interface ScanPanelOptions {
  scan: (signal: AbortSignal) => Promise<Finding[]>;
  deepScan: (signal: AbortSignal, onProgress: (fraction: number) => void) => Promise<Finding[]>;
  onUpdate: () => void;
  highlightRoot: HTMLElement;
}

export interface ScanPanel {
  render(): Promise<void>;
  clear(): void;
  isDeepScanRunning(): boolean;
  live: HTMLElement;
}

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'advisory'];
const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', advisory: 'Advisory' };
const SEVERITY_COUNT: Record<Severity, [one: string, other: string]> = {
  error: ['error', 'errors'],
  warning: ['warning', 'warnings'],
  advisory: ['advisory', 'advisories'],
};
const MAX_ROWS = 10;
const PROGRESS_TEXT_INTERVAL_MS = 1000;
const PROGRESS_ANNOUNCE_STEPS = 4;

export async function scanPage(
  win: Window,
  host: Element,
  signal: AbortSignal,
  rules: readonly Rule[] = ALL_RULES,
): Promise<Finding[]> {
  return (await collectFindings([...rules], createScanContext(win), signal)).filter(
    (finding) => !finding.el || !host.contains(finding.el),
  );
}

export async function deepScanPage(
  win: Window,
  host: Element,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<Finding[]> {
  await revealSweep(win, signal, onProgress);
  return scanPage(win, host, signal, [...ALL_RULES, ...DEEP_SCAN_RULES]);
}

export function createScanPanel(panel: HTMLElement, options: ScanPanelOptions): ScanPanel {
  let renderVersion = 0;
  const highlight = createLocateHighlight();
  let stopScan: (() => void) | undefined;
  let deepScan: AbortController | undefined;
  let severityFilter: Severity | 'all' = 'all';
  let focusRescan = false;
  const { element: live, announce } = createLiveRegion(panel.ownerDocument);

  function setStatus(status: HTMLElement, text: string): void {
    status.textContent = text;
    announce(text);
  }

  function begin(statusText: string): {
    version: number;
    controller: AbortController;
    document: Document;
    heading: HTMLElement;
    status: HTMLElement;
  } {
    const version = ++renderVersion;
    focusRescan = false;
    stopScan?.();
    highlight.remove();
    const controller = new AbortController();
    stopScan = () => {
      stopScan = undefined;
      controller.abort();
    };
    const document = panel.ownerDocument;
    const heading = document.createElement('h2');
    heading.textContent = 'Design scan';
    const status = document.createElement('p');
    status.dataset.annotationStatus = '';
    setStatus(status, statusText);
    panel.replaceChildren(heading, status);
    return { version, controller, document, heading, status };
  }

  async function render(): Promise<void> {
    const { version, controller, document, status } = begin('Scanning…');

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (version !== renderVersion) return;

    let findings: Finding[];
    try {
      findings = await options.scan(controller.signal);
    } catch (error) {
      if (version !== renderVersion) return;
      stopScan = undefined;
      setStatus(status, `Scan failed: ${errorMessage(error)}`);
      return;
    }

    if (version !== renderVersion) return;
    stopScan = undefined;
    status.remove();
    showFindings(document, findings, '');
  }

  async function runDeepScan(): Promise<void> {
    const { version, controller, document, heading, status } = begin('Deep scan running…');
    deepScan = controller;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.annotationDeepScanCancel = '';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => controller.abort());
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.abort();
    };
    document.addEventListener('keydown', onKeydown);
    controller.signal.addEventListener('abort', () => document.removeEventListener('keydown', onKeydown));
    // Read before the Cancel button is removed: focus follows only if it was still inside the panel
    // (on Cancel), never pulled from elsewhere on the page. The panel lives in a shadow root, so read
    // that root's activeElement, not document.activeElement.
    let focusWasInPanel = false;
    const finish = () => {
      stopScan = undefined;
      deepScan = undefined;
      document.removeEventListener('keydown', onKeydown);
      focusWasInPanel = focusIsInPanel();
    };
    const restoreFocus = () => {
      if (focusWasInPanel) panel.querySelector<HTMLButtonElement>('[data-annotation-deep-scan]')?.focus();
    };
    panel.append(cancel);
    cancel.focus();

    // The visible text updates at most once a second and the live region only at 25% steps.
    let shownAt = Number.NEGATIVE_INFINITY;
    let announcedStep = 0;
    const onProgress = (fraction: number) => {
      if (version !== renderVersion || controller.signal.aborted) return;
      const text = `Deep scan running… ${Math.floor(fraction * 100)}%`;
      const now = Date.now();
      if (now - shownAt >= PROGRESS_TEXT_INTERVAL_MS) {
        shownAt = now;
        status.textContent = text;
      }
      const step = Math.floor(fraction * PROGRESS_ANNOUNCE_STEPS);
      if (step > announcedStep) {
        announcedStep = step;
        announce(`Deep scan running… ${step * (100 / PROGRESS_ANNOUNCE_STEPS)}%`);
      }
    };

    let findings: Finding[];
    try {
      findings = await options.deepScan(controller.signal, onProgress);
    } catch (error) {
      if (version !== renderVersion) return;
      finish();
      if (controller.signal.aborted) {
        setStatus(status, 'Deep scan cancelled');
        panel.replaceChildren(heading, status, createDeepScanButton(document));
        restoreFocus();
      } else {
        setStatus(status, `Scan failed: ${errorMessage(error)}`);
        panel.replaceChildren(heading, status);
      }
      options.onUpdate();
      return;
    }
    if (version !== renderVersion) return;
    finish();
    panel.replaceChildren(heading);
    showFindings(document, findings, 'Deep scan: ');
    restoreFocus();
    options.onUpdate();
  }

  function focusIsInPanel(): boolean {
    return panel.contains((panel.getRootNode() as Document | ShadowRoot).activeElement ?? null);
  }

  function createRescanButton(document: Document): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.annotationRescan = '';
    button.textContent = 'Rescan';
    button.addEventListener('click', () => {
      const wasInPanel = focusIsInPanel();
      void render();
      // render() resets the flag synchronously in begin(); set it after so only this scan's result takes focus.
      focusRescan = wasInPanel;
    });
    return button;
  }

  function createFilter(document: Document, findings: Finding[], groups: { severity: Severity; element: HTMLElement }[]): HTMLElement {
    const filter = document.createElement('div');
    filter.dataset.annotationFilter = '';
    filter.setAttribute('role', 'group');
    filter.setAttribute('aria-label', 'Filter by severity');
    const options: { value: Severity | 'all'; label: string; count: number }[] = [
      { value: 'all', label: 'All', count: findings.length },
    ];
    for (const severity of SEVERITY_ORDER) {
      const count = findings.filter((finding) => finding.severity === severity).length;
      const plural = SEVERITY_COUNT[severity][1];
      if (count > 0) options.push({ value: severity, label: plural[0]!.toUpperCase() + plural.slice(1), count });
    }
    const chips = options.map(({ value, label, count }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.annotationFilterValue = value;
      chip.textContent = `${label} (${count})`;
      chip.addEventListener('click', () => {
        severityFilter = value;
        apply(value);
        announce(value === 'all' ? 'Showing all findings' : `Showing ${label.toLowerCase()} only`);
      });
      return chip;
    });
    const apply = (value: Severity | 'all') => {
      chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.annotationFilterValue === value)));
      for (const group of groups) group.element.hidden = value !== 'all' && group.severity !== value;
    };
    apply(options.some((option) => option.value === severityFilter) ? severityFilter : 'all');
    filter.append(...chips);
    return filter;
  }

  function createDeepScanButton(document: Document): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.annotationDeepScan = '';
    button.textContent = 'Deep scan (scrolls the page)';
    button.addEventListener('click', () => void runDeepScan());
    return button;
  }

  function showFindings(document: Document, findings: Finding[], prefix: string): void {
    const count = (severity: Severity) => {
      const total = findings.filter((finding) => finding.severity === severity).length;
      return `${total} ${SEVERITY_COUNT[severity][total === 1 ? 0 : 1]}`;
    };
    const summary = document.createElement('p');
    summary.dataset.annotationScanSummary = '';
    summary.textContent = `${prefix}${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}: ${count('error')}, ${count('warning')}, ${count('advisory')}`;
    announce(summary.textContent);
    const rescan = createRescanButton(document);
    panel.append(summary, createDeepScanButton(document), rescan);
    if (focusRescan) {
      focusRescan = false;
      rescan.focus();
    }

    if (findings.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.annotationEmptyState = '';
      empty.textContent = 'No findings on this page.';
      panel.append(empty);
      return;
    }

    const groups = new Map<string, Finding[]>();
    for (const finding of findings) {
      const group = groups.get(finding.ruleId);
      if (group) group.push(finding);
      else groups.set(finding.ruleId, [finding]);
    }
    const ordered = [...groups.values()].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a[0]!.severity) - SEVERITY_ORDER.indexOf(b[0]!.severity) ||
        a[0]!.name.localeCompare(b[0]!.name),
    );
    const groupElements = ordered.map((group) => ({ severity: group[0]!.severity, element: createGroup(document, group) }));
    panel.append(createFilter(document, findings, groupElements), ...groupElements.map((group) => group.element));
  }

  function createGroup(document: Document, group: Finding[]): HTMLElement {
    const first = group[0]!;
    const details = document.createElement('details');
    details.dataset.annotationScanGroup = '';
    details.dataset.ruleId = first.ruleId;
    details.open = first.severity !== 'advisory';

    const heading = document.createElement('h3');
    heading.textContent = `${first.name} (${group.length})`;

    const severity = document.createElement('span');
    severity.dataset.annotationSeverity = first.severity;
    severity.textContent = SEVERITY_LABEL[first.severity];

    const description = document.createElement('p');
    description.textContent = first.description;

    const list = document.createElement('ul');
    group.slice(0, MAX_ROWS).forEach((finding, index) => list.append(createRow(document, finding, index)));
    if (group.length > MAX_ROWS) {
      const item = document.createElement('li');
      const more = document.createElement('button');
      more.type = 'button';
      more.dataset.annotationScanMore = '';
      more.textContent = `+${group.length - MAX_ROWS} more`;
      more.addEventListener('click', () => {
        const rows = group.slice(MAX_ROWS).map((finding, index) => createRow(document, finding, MAX_ROWS + index));
        item.replaceWith(...rows);
        rows[0]!.tabIndex = -1;
        rows[0]!.focus();
      });
      item.append(more);
      list.append(item);
    }

    const summary = document.createElement('summary');
    summary.append(heading, ' ', severity);
    details.append(summary, description, list);
    return details;
  }

  function createRow(document: Document, finding: Finding, index: number): HTMLElement {
    const row = document.createElement('li');
    row.dataset.annotationScanFinding = '';
    const detail = document.createElement('span');
    detail.textContent = finding.detail;
    row.append(detail);
    const el = finding.el;
    if (el?.isConnected) {
      const locate = document.createElement('button');
      locate.type = 'button';
      locate.dataset.annotationScanLocate = '';
      locate.textContent = 'Locate';
      locate.setAttribute('aria-label', `Locate finding ${index + 1}: ${finding.name}`);
      locate.addEventListener('click', () => highlight.show(options.highlightRoot, el));
      row.append(' ', locate);
    }
    return row;
  }

  function clear(): void {
    renderVersion += 1;
    focusRescan = false;
    stopScan?.();
    highlight.remove();
    panel.replaceChildren();
    announce('');
  }

  function isDeepScanRunning(): boolean {
    return deepScan !== undefined && !deepScan.signal.aborted;
  }

  return { render, clear, isDeepScanRunning, live };
}
