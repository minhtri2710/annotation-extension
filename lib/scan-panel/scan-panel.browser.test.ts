import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { Finding, Severity } from '../lint/engine';
import { contrastRatio, parseColor } from '../lint/color';
import { applyThemeMode } from '../ui/theme';
import { buildOverlayShell, createPanelAnchor } from '../ui/shell';
import { createPanelMode } from '../wiring/panel-mode';
import { createScanPanel } from './scan-panel';

const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
  window.scrollTo(0, 0);
  await page.viewport(1280, 720);
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function finding(severity: Severity, detail: string, el?: Element): Finding {
  return { ruleId: severity, name: severity, description: '', severity, detail, el };
}

function box(margin: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `margin: ${margin}; width: 160px; height: 40px; background: #ddd;`;
  return el;
}

function mountScan(findings: Finding[], theme: 'light' | 'dark', scan: () => Promise<Finding[]> = async () => findings, deepScan: () => Promise<Finding[]> = () => new Promise<Finding[]>(() => {})) {
  const host = document.createElement('div');
  document.body.append(host);
  const container = document.createElement('div');
  host.attachShadow({ mode: 'open' }).append(container);
  const shell = buildOverlayShell(container);
  applyThemeMode(shell.root, theme);
  const scanPanel = createScanPanel(shell.panel, {
    scan,
    deepScan,
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

describe('scan panel buttons in a real browser', () => {
  it.each(['light', 'dark'] as const)('keeps the token gap between Deep scan and Rescan and between Locate and Annotate (%s)', async (theme) => {
    const target = box('20px 0 0 40px');
    document.body.append(target);
    const { shell, scanToggle } = mountScan([finding('error', 'contrast', target)], theme);
    scanToggle.click();
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-scan-annotate]')).not.toBeNull());

    const probe = document.createElement('span');
    probe.style.display = 'block';
    probe.style.width = 'var(--annotation-space-2)';
    shell.root.append(probe);
    const gapToken = probe.getBoundingClientRect().width;
    probe.remove();
    expect(gapToken).toBeGreaterThanOrEqual(8);

    const gap = (first: Element, second: Element) => {
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return Math.max(b.left - a.right, b.top - a.bottom);
    };
    const pick = (selector: string) => shell.panel.querySelector(selector)!;
    expect(gap(pick('[data-annotation-deep-scan]'), pick('[data-annotation-rescan]'))).toBeGreaterThanOrEqual(gapToken);
    expect(gap(pick('[data-annotation-scan-locate]'), pick('[data-annotation-scan-annotate]'))).toBeGreaterThanOrEqual(gapToken);
  });
});

describe('scan panel rows and controls in a real browser', () => {
  const LONG_DETAIL = 'Text is 11px on a 12px line over a very light grey background, '.repeat(6);

  async function mountRows(theme: 'light' | 'dark' = 'light') {
    const first = box('20px 0 0 40px');
    const second = box('20px 0 0 40px');
    document.body.append(first, second);
    const mounted = mountScan(
      [finding('error', LONG_DETAIL, first), finding('error', 'short detail', second), finding('error', 'no element here')],
      theme,
    );
    mounted.scanToggle.click();
    await vi.waitFor(() => expect(mounted.shell.panel.querySelectorAll('[data-annotation-scan-annotate]')).toHaveLength(2));
    await nextFrame();
    return mounted;
  }

  it.each(['light', 'dark'] as const)('lays each element row out on one line with a filled number chip, a truncated detail, an icon-only Locate and Annotate, and no bullet (%s)', async (theme) => {
    const { shell } = await mountRows(theme);
    const rows = [...shell.panel.querySelectorAll<HTMLElement>('[data-annotation-scan-number]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const style = getComputedStyle(row);
      expect(style.listStyleType).toBe('none');
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(36);
      const chip = getComputedStyle(row, '::before');
      expect(chip.borderTopWidth).toBe('0px');
      expect(chip.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    }
    const detail = rows[0]!.firstElementChild as HTMLElement;
    expect(detail.title).toBe(LONG_DETAIL);
    expect(detail.scrollWidth).toBeGreaterThan(detail.clientWidth);
    expect(getComputedStyle(detail).textOverflow).toBe('ellipsis');
    expect((rows[1]!.firstElementChild as HTMLElement).title).toBe('short detail');

    const locate = rows[0]!.querySelector<HTMLButtonElement>('[data-annotation-scan-locate]')!;
    expect(locate.textContent).toBe('');
    expect(locate.querySelector('svg')).not.toBeNull();
    expect(locate.getBoundingClientRect().top).toBe(rows[0]!.querySelector('[data-annotation-scan-annotate]')!.getBoundingClientRect().top);
    expect(locate.getAttribute('aria-label')).toMatch(/^Locate finding 1: /);
    expect(locate.title).toBe(locate.getAttribute('aria-label'));
    expect(rows[0]!.querySelector('[data-annotation-scan-annotate]')!.textContent).toBe('Annotate');

    const tag = shell.panel.querySelector('[data-annotation-scan-page-level]')!;
    expect(tag.textContent).toBe('Page-level');
    const pageRow = tag.parentElement!;
    expect(pageRow.getBoundingClientRect().height).toBeLessThanOrEqual(36);
    expect(getComputedStyle(pageRow).listStyleType).toBe('none');
  });

  it.each(['light', 'dark'] as const)('keeps Annotate on one line at its natural width however long the detail is (%s)', async (theme) => {
    const { shell } = await mountRows(theme);
    const [longRow, shortRow] = [...shell.panel.querySelectorAll<HTMLElement>('[data-annotation-scan-number]')];
    const longButton = longRow!.querySelector<HTMLButtonElement>('[data-annotation-scan-annotate]')!;
    const shortButton = shortRow!.querySelector<HTMLButtonElement>('[data-annotation-scan-annotate]')!;
    const range = document.createRange();
    range.selectNodeContents(longButton.firstChild!);
    const tops = [...range.getClientRects()].map((rect) => rect.top);
    expect(tops.length).toBeGreaterThan(0);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(longButton.getBoundingClientRect().width - shortButton.getBoundingClientRect().width)).toBeLessThanOrEqual(0.5);
    expect(longButton.scrollWidth).toBeLessThanOrEqual(longButton.clientWidth);
  });

  it.each(['light', 'dark'] as const)('makes Deep scan, Rescan, Locate and Annotate 28 px high with an 8 px gap between neighbours (%s)', async (theme) => {
    const { shell } = await mountRows(theme);
    const pick = (selector: string) => shell.panel.querySelector<HTMLElement>(selector)!;
    const deep = pick('[data-annotation-deep-scan]');
    const rescan = pick('[data-annotation-rescan]');
    const locate = pick('[data-annotation-scan-locate]');
    const annotate = pick('[data-annotation-scan-annotate]');
    for (const button of [deep, rescan, locate, annotate]) expect(button.getBoundingClientRect().height).toBe(28);
    const gap = (a: Element, b: Element) => b.getBoundingClientRect().left - a.getBoundingClientRect().right;
    expect(gap(deep, rescan)).toBeCloseTo(8, 1);
    expect(gap(locate, annotate)).toBeCloseTo(8, 1);
  });

  it('keeps the header in view while the findings scroll', async () => {
    await page.viewport(600, 400);
    const targets = Array.from({ length: 12 }, () => box('4px 0 0 40px'));
    document.body.append(...targets);
    const { shell, scanToggle } = mountScan(targets.map((el, index) => finding('error', `finding ${index}`, el)), 'light');
    scanToggle.click();
    await vi.waitFor(() => expect(shell.panel.querySelectorAll('[data-annotation-scan-annotate]').length).toBeGreaterThan(5));
    await nextFrame();
    shell.panel.scrollTop = shell.panel.scrollHeight;
    expect(shell.panel.scrollTop).toBeGreaterThan(0);
    const header = shell.panel.querySelector('[data-annotation-scan-header]')!.getBoundingClientRect();
    const top = shell.panel.getBoundingClientRect().top;
    expect(header.top).toBeGreaterThanOrEqual(top);
    expect(header.top).toBeLessThanOrEqual(top + 2);
    const close = shell.panel.querySelector<HTMLElement>('[data-annotation-close]')!;
    const rect = close.getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(shell.panel.getBoundingClientRect().bottom);
    expect((shell.root.getRootNode() as ShadowRoot).elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(close);
  });

  it('shows the findings after Rescan instead of leaving the panel at its Scanning height', async () => {
    await page.viewport(1280, 720);
    const items = Array.from({ length: 24 }, (_, index) => finding('warning', `page-level ${index}`));
    let release: (findings: Finding[]) => void = () => undefined;
    let calls = 0;
    const { shell, scanToggle } = mountScan(items, 'light', () => {
      calls += 1;
      return calls === 1 ? Promise.resolve(items) : new Promise<Finding[]>((resolve) => { release = resolve; });
    });
    scanToggle.click();
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-rescan]')).not.toBeNull());
    await nextFrame();
    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-rescan]')!.click();
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scanning…'));
    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const scanning = shell.panel.getBoundingClientRect().height;
    release(items);
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-scan-finding]')).not.toBeNull());
    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const panelRect = shell.panel.getBoundingClientRect();
    expect(panelRect.height).toBeGreaterThan(scanning);
    const row = shell.panel.querySelector('[data-annotation-scan-finding]')!.getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(panelRect.top);
    expect(row.bottom).toBeLessThanOrEqual(panelRect.bottom);
  });

  it('shows the deep scan findings after a running state that the panel was placed at', async () => {
    await page.viewport(1280, 720);
    const items = Array.from({ length: 24 }, (_, index) => finding('warning', `page-level ${index}`));
    let release: (findings: Finding[]) => void = () => undefined;
    const { shell, scanToggle } = mountScan(items, 'light', async () => items, () => new Promise<Finding[]>((resolve) => { release = resolve; }));
    scanToggle.click();
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-deep-scan]')).not.toBeNull());
    await nextFrame();
    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-deep-scan]')!.click();
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-status]')?.textContent).toContain('Deep scan running…'));
    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const running = shell.panel.getBoundingClientRect().height;
    release(items);
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-scan-finding]')).not.toBeNull());
    await nextFrame();
    await Promise.all(shell.root.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const panelRect = shell.panel.getBoundingClientRect();
    expect(panelRect.height).toBeGreaterThan(running);
    const row = shell.panel.querySelector('[data-annotation-scan-finding]')!.getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(panelRect.top);
    expect(row.bottom).toBeLessThanOrEqual(panelRect.bottom);
  });
});

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
