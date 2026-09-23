import { collectFindings, createScanContext, type Finding, type Rule, type Severity } from '../lint/engine';
import { ALL_RULES, DEEP_SCAN_RULES } from '../lint/rules';
import { revealSweep } from './reveal-sweep';

export interface ScanPanelOptions {
  scan: () => Finding[];
  deepScan: (signal: AbortSignal) => Promise<Finding[]>;
  onUpdate: () => void;
  highlightRoot: HTMLElement;
}

export interface ScanPanel {
  render(): Promise<void>;
  clear(): void;
}

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'advisory'];
const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', advisory: 'Advisory' };
const MAX_ROWS = 10;
const HIGHLIGHT_MS = 1500;

export function scanPage(win: Window, host: Element, rules: readonly Rule[] = ALL_RULES): Finding[] {
  return collectFindings([...rules], createScanContext(win)).filter(
    (finding) => !finding.el || !host.contains(finding.el),
  );
}

export async function deepScanPage(win: Window, host: Element, signal: AbortSignal): Promise<Finding[]> {
  await revealSweep(win, signal);
  return scanPage(win, host, [...ALL_RULES, ...DEEP_SCAN_RULES]);
}

export function createScanPanel(panel: HTMLElement, options: ScanPanelOptions): ScanPanel {
  let renderVersion = 0;
  let highlight: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let stopDeepScan: (() => void) | undefined;

  function begin(statusText: string): { version: number; document: Document; heading: HTMLElement; status: HTMLElement } {
    const version = ++renderVersion;
    stopDeepScan?.();
    removeHighlight();
    const document = panel.ownerDocument;
    const heading = document.createElement('h2');
    heading.textContent = 'Design scan';
    const status = document.createElement('p');
    status.dataset.annotationStatus = '';
    status.textContent = statusText;
    panel.replaceChildren(heading, status);
    return { version, document, heading, status };
  }

  async function render(): Promise<void> {
    const { version, document, status } = begin('Scanning…');

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (version !== renderVersion) return;

    let findings: Finding[];
    try {
      findings = options.scan();
    } catch (error) {
      status.textContent = `Scan failed: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }

    status.remove();
    showFindings(document, findings, '');
  }

  async function runDeepScan(): Promise<void> {
    const { version, document, heading, status } = begin('Deep scan running…');
    const controller = new AbortController();
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.annotationDeepScanCancel = '';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => controller.abort());
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.abort();
    };
    document.addEventListener('keydown', onKeydown);
    const finish = () => {
      stopDeepScan = undefined;
      document.removeEventListener('keydown', onKeydown);
    };
    stopDeepScan = () => {
      finish();
      controller.abort();
    };
    panel.append(cancel);
    cancel.focus();

    let findings: Finding[];
    try {
      findings = await options.deepScan(controller.signal);
    } catch (error) {
      if (version !== renderVersion) return;
      finish();
      if (controller.signal.aborted) {
        status.textContent = 'Deep scan cancelled';
        panel.replaceChildren(heading, status, createDeepScanButton(document));
      } else {
        status.textContent = `Scan failed: ${error instanceof Error ? error.message : String(error)}`;
        panel.replaceChildren(heading, status);
      }
      options.onUpdate();
      return;
    }
    if (version !== renderVersion) return;
    finish();
    panel.replaceChildren(heading);
    showFindings(document, findings, 'Deep scan: ');
    options.onUpdate();
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
    const count = (severity: Severity) => findings.filter((finding) => finding.severity === severity).length;
    const summary = document.createElement('p');
    summary.dataset.annotationScanSummary = '';
    summary.textContent = `${prefix}${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}: ${count('error')} errors, ${count('warning')} warnings, ${count('advisory')} advisory`;
    panel.append(summary, createDeepScanButton(document));

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
    for (const group of ordered) panel.append(createGroup(document, group));
  }

  function createGroup(document: Document, group: Finding[]): HTMLElement {
    const first = group[0]!;
    const section = document.createElement('section');
    section.dataset.annotationScanGroup = '';
    section.dataset.ruleId = first.ruleId;

    const heading = document.createElement('h3');
    heading.textContent = `${first.name} (${group.length})`;

    const severity = document.createElement('span');
    severity.dataset.annotationSeverity = first.severity;
    severity.textContent = SEVERITY_LABEL[first.severity];

    const description = document.createElement('p');
    description.textContent = first.description;

    const list = document.createElement('ul');
    for (const finding of group.slice(0, MAX_ROWS)) list.append(createRow(document, finding));
    if (group.length > MAX_ROWS) {
      const more = document.createElement('li');
      more.textContent = `+${group.length - MAX_ROWS} more`;
      list.append(more);
    }

    section.append(heading, severity, description, list);
    return section;
  }

  function createRow(document: Document, finding: Finding): HTMLElement {
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
      locate.addEventListener('click', () => showHighlight(el));
      row.append(' ', locate);
    }
    return row;
  }

  function showHighlight(el: Element): void {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    removeHighlight();
    const rect = el.getBoundingClientRect();
    highlight = options.highlightRoot.ownerDocument.createElement('div');
    highlight.dataset.annotationScanHighlight = '';
    Object.assign(highlight.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    options.highlightRoot.append(highlight);
    highlightTimer = setTimeout(removeHighlight, HIGHLIGHT_MS);
  }

  function removeHighlight(): void {
    clearTimeout(highlightTimer);
    highlightTimer = undefined;
    highlight?.remove();
    highlight = undefined;
  }

  function clear(): void {
    renderVersion += 1;
    stopDeepScan?.();
    removeHighlight();
    panel.replaceChildren();
  }

  return { render, clear };
}
