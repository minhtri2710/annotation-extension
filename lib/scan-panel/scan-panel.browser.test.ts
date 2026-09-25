import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding, Severity } from '../lint/engine';
import { contrastRatio, parseColor } from '../lint/color';
import { applyThemeMode } from '../ui/theme';
import { buildOverlayShell, createPanelAnchor } from '../ui/shell';
import { createPanelMode } from '../wiring/panel-mode';
import { createScanPanel } from './scan-panel';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function finding(severity: Severity, detail: string, el?: Element): Finding {
  return { ruleId: severity, name: severity, description: '', severity, category: 'quality', detail, el };
}

function box(margin: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `margin: ${margin}; width: 160px; height: 40px; background: #ddd;`;
  return el;
}

// Mirrors content.ts: the scan panel in the overlay shell, opened and closed by the real Scan toggle.
function mountScan(findings: Finding[], theme: 'light' | 'dark') {
  const host = document.createElement('div');
  document.body.append(host);
  const container = document.createElement('div');
  host.attachShadow({ mode: 'open' }).append(container);
  const shell = buildOverlayShell(container);
  applyThemeMode(shell.root, theme);
  const scanPanel = createScanPanel(shell.panel, {
    scan: async () => findings,
    deepScan: () => new Promise<Finding[]>(() => {}),
    onUpdate: () => undefined,
    highlightRoot: shell.root,
    onAnnotate: () => undefined,
  });
  cleanups.push(() => scanPanel.clear());
  const anchor = createPanelAnchor(shell.panel, shell.toolbar);
  cleanups.push(() => anchor.destroy());
  const scanToggle = document.createElement('button');
  const panels = createPanelMode({
    panel: shell.panel,
    overlayRoot: shell.root.getRootNode() as ShadowRoot,
    anchor,
    anchorToToolbar: () => shell.toolbar.getBoundingClientRect(),
    notePanel: { render: async () => undefined, clear: () => undefined },
    scanPanel,
    annotationList: () => ({ render: async () => undefined, clear: () => undefined }),
    listToggle: document.createElement('button'),
    scanToggle,
  });
  scanToggle.type = 'button';
  scanToggle.textContent = 'Scan';
  scanToggle.addEventListener('click', () => panels.toggle('scan'));
  shell.toolbar.append(scanToggle);
  return { shell, scanToggle };
}

function tokenColor(root: HTMLElement, token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  root.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function expectOver(outline: Element, el: Element): void {
  const shown = outline.getBoundingClientRect();
  const target = el.getBoundingClientRect();
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    expect(Math.abs(shown[side] - target[side]), side).toBeLessThanOrEqual(1);
  }
}

describe('scan panel outlines in a real browser', () => {
  it.each(['light', 'dark'] as const)('outlines each element finding over its element in its severity colour, through scrolling, until the Scan toggle closes it (%s)', async (theme) => {
    const error = box('300px 0 0 40px');
    const warning = box('200px 0 0 240px');
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    document.body.append(error, warning, spacer);
    const { shell, scanToggle } = mountScan(
      [finding('error', 'contrast', error), finding('warning', 'tiny', warning), finding('error', 'skipped heading level')],
      theme,
    );

    scanToggle.click();
    await vi.waitFor(() => expect(shell.root.querySelectorAll('[data-annotation-scan-outline]')).toHaveLength(2));
    const [errorOutline, warningOutline] = [...shell.root.querySelectorAll<HTMLElement>('[data-annotation-scan-outline]')];
    expect(shell.panel.querySelector('[data-annotation-scan-page-level]')?.textContent).toBe('Page-level');
    expectOver(errorOutline!, error);
    expectOver(warningOutline!, warning);

    window.scrollTo(0, 250);
    await nextFrame();
    expect(window.scrollY).toBe(250);
    expectOver(errorOutline!, error);
    expectOver(warningOutline!, warning);

    for (const [outline, token] of [[errorOutline!, '--annotation-color-danger'], [warningOutline!, '--annotation-color-warning']] as const) {
      expect(getComputedStyle(outline).outlineColor).toBe(tokenColor(shell.root, token));
      const label = getComputedStyle(outline.querySelector('[data-annotation-scan-outline-number]')!);
      expect(label.backgroundColor).toBe(tokenColor(shell.root, token));
      expect(contrastRatio(parseColor(label.color)!, parseColor(label.backgroundColor)!)).toBeGreaterThanOrEqual(4.5);
    }
    expect([errorOutline!.textContent, warningOutline!.textContent]).toEqual(['1', '2']);

    scanToggle.click();
    expect(shell.root.querySelector('[data-annotation-scan-outline]')).toBeNull();
  });
});
