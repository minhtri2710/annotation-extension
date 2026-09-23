// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding, Rule, Severity } from '../lint/engine';
import { createScanPanel, scanPage } from './scan-panel';

function finding(ruleId: string, name: string, severity: Severity, detail: string, el?: Element): Finding {
  return {
    ruleId, name, description: `${name} description`, severity, category: 'quality',
    advisory: severity === 'advisory', detail, el,
  };
}

function setup(scan: () => Finding[]) {
  const panel = document.createElement('div');
  const highlightRoot = document.createElement('div');
  document.body.append(panel, highlightRoot);
  return { panel, highlightRoot, scanPanel: createScanPanel(panel, { scan, highlightRoot }) };
}

async function renderNow(render: () => Promise<void>): Promise<void> {
  const done = render();
  await vi.runAllTimersAsync();
  await done;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('scanPage', () => {
  it('drops findings on the host and its descendants and keeps the rest', () => {
    const host = document.createElement('div');
    host.id = 'host';
    const child = document.createElement('span');
    child.id = 'child';
    host.append(child);
    const other = document.createElement('p');
    other.id = 'other';
    document.body.append(host, other);
    const everything: Rule = {
      id: 'stub', category: 'quality', name: 'Stub', description: 'Hits every element', scope: 'element',
      test: (el) => [{ detail: el.id }],
    };
    const hit = scanPage(window, host, [everything]).map((f) => f.el);
    expect(hit).not.toContain(host);
    expect(hit).not.toContain(child);
    expect(hit).toContain(other);
    expect(hit).toContain(document.body);
  });
});

describe('scan panel', () => {
  it('shows a scanning status and yields a macrotask before scanning', async () => {
    vi.useFakeTimers();
    const scan = vi.fn(() => [] as Finding[]);
    const { panel, scanPanel } = setup(scan);
    const done = scanPanel.render();
    expect(panel.querySelector('h2')?.textContent).toBe('Design scan');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scanning…');
    expect(scan).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await done;
    expect(scan).toHaveBeenCalledTimes(1);
    expect(panel.querySelector('[data-annotation-status]')).toBeNull();
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('0 findings: 0 errors, 0 warnings, 0 advisory');
    expect(panel.querySelector('[data-annotation-empty-state]')?.textContent).toBe('No findings on this page.');
  });

  it('cancels a stale render on clear() or a newer render()', async () => {
    vi.useFakeTimers();
    const scan = vi.fn(() => [finding('a', 'A', 'error', 'x')]);
    const { panel, scanPanel } = setup(scan);
    const stale = scanPanel.render();
    scanPanel.clear();
    await vi.runAllTimersAsync();
    await stale;
    expect(scan).not.toHaveBeenCalled();
    expect(panel.childElementCount).toBe(0);

    const first = scanPanel.render();
    const second = scanPanel.render();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(panel.querySelectorAll('[data-annotation-scan-summary]')).toHaveLength(1);
  });

  it('fails closed with the error message and no list when the scan throws', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel } = setup(() => {
      throw new Error('boom');
    });
    await renderNow(scanPanel.render);
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scan failed: boom');
    expect(panel.querySelector('[data-annotation-scan-summary]')).toBeNull();
    expect(panel.querySelector('[data-annotation-scan-group]')).toBeNull();
    expect(panel.querySelector('[data-annotation-empty-state]')).toBeNull();
  });

  it('summarizes with a singular for exactly one finding', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel } = setup(() => [finding('a', 'A', 'warning', 'x')]);
    await renderNow(scanPanel.render);
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('1 finding: 0 errors, 1 warnings, 0 advisory');
  });

  it('groups by rule, orders by severity then name, caps rows at ten, and renders text only', async () => {
    vi.useFakeTimers();
    const target = document.createElement('p');
    document.body.append(target);
    const detached = document.createElement('p');
    const findings = [
      finding('adv', 'Zed advisory', 'advisory', 'a1'),
      finding('warn-b', 'Beta warning', 'warning', '<img src=x onerror=alert(1)>', target),
      finding('warn-a', 'Alpha warning', 'warning', 'wa1', detached),
      ...Array.from({ length: 12 }, (_, i) => finding('err', 'Error rule', 'error', `e${i}`, target)),
    ];
    const { panel, scanPanel } = setup(() => findings);
    await renderNow(scanPanel.render);

    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('15 findings: 12 errors, 2 warnings, 1 advisory');
    const groups = [...panel.querySelectorAll<HTMLElement>('[data-annotation-scan-group]')];
    expect(groups.map((g) => g.dataset.ruleId)).toEqual(['err', 'warn-a', 'warn-b', 'adv']);

    const [err, warnA, warnB, adv] = groups;
    expect(err?.querySelector('h3')?.textContent).toBe('Error rule (12)');
    expect(err?.querySelector('[data-annotation-severity]')?.getAttribute('data-annotation-severity')).toBe('error');
    expect(err?.querySelector('[data-annotation-severity]')?.textContent).toBe('Error');
    expect(warnA?.querySelector('[data-annotation-severity]')?.textContent).toBe('Warning');
    expect(adv?.querySelector('[data-annotation-severity="advisory"]')?.textContent).toBe('Advisory');
    expect(err?.querySelector('p')?.textContent).toBe('Error rule description');
    const rows = err?.querySelectorAll('[data-annotation-scan-finding]') ?? [];
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain('e0');
    const items = err?.querySelectorAll('li') ?? [];
    expect(items[items.length - 1]?.textContent).toBe('+2 more');

    expect(warnB?.querySelector('[data-annotation-scan-finding]')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('img')).toBeNull();
    expect(warnB?.querySelector('[data-annotation-scan-locate]')?.textContent).toBe('Locate');
    expect(warnB?.querySelector<HTMLButtonElement>('[data-annotation-scan-locate]')?.type).toBe('button');
    expect(warnA?.querySelector('[data-annotation-scan-locate]')).toBeNull();
    expect(adv?.querySelector('[data-annotation-scan-locate]')).toBeNull();
  });

  it('locates: scrolls without smooth behavior, draws one fixed highlight, removes it after 1500ms', async () => {
    vi.useFakeTimers();
    const a = document.createElement('p');
    const b = document.createElement('p');
    document.body.append(a, b);
    const scrollA = vi.fn();
    const scrollB = vi.fn();
    a.scrollIntoView = scrollA;
    b.scrollIntoView = scrollB;
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 30, height: 40 }));
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 }));
    const { panel, highlightRoot, scanPanel } = setup(() => [finding('r', 'R', 'error', 'a', a), finding('r', 'R', 'error', 'b', b)]);
    await renderNow(scanPanel.render);
    const [locateA, locateB] = [...panel.querySelectorAll<HTMLButtonElement>('[data-annotation-scan-locate]')];

    locateA?.click();
    expect(scrollA).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    const highlight = highlightRoot.querySelector<HTMLElement>('[data-annotation-scan-highlight]');
    expect(highlight?.style.position).toBe('fixed');
    expect([highlight?.style.top, highlight?.style.left, highlight?.style.width, highlight?.style.height]).toEqual(['20px', '10px', '30px', '40px']);

    locateB?.click();
    expect(scrollB).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    const highlights = highlightRoot.querySelectorAll<HTMLElement>('[data-annotation-scan-highlight]');
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.style.top).toBe('2px');

    vi.advanceTimersByTime(1499);
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).toBeNull();
  });

  it('clear() removes the highlight and empties the panel', async () => {
    vi.useFakeTimers();
    const a = document.createElement('p');
    document.body.append(a);
    a.scrollIntoView = vi.fn();
    const { panel, highlightRoot, scanPanel } = setup(() => [finding('r', 'R', 'error', 'a', a)]);
    await renderNow(scanPanel.render);
    panel.querySelector<HTMLButtonElement>('[data-annotation-scan-locate]')?.click();
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).not.toBeNull();
    scanPanel.clear();
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).toBeNull();
    expect(panel.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
