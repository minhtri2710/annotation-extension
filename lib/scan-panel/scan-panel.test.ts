// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding, Rule, Severity } from '../lint/engine';
import { hiddenAtRestRules } from '../lint/rules/hidden-at-rest';
import { createScanPanel, deepScanPage, scanPage } from './scan-panel';

function finding(ruleId: string, name: string, severity: Severity, detail: string, el?: Element): Finding {
  return {
    ruleId, name, description: `${name} description`, severity, category: 'quality',
    advisory: severity === 'advisory', detail, el,
  };
}

type DeepScan = (signal: AbortSignal) => Promise<Finding[]>;
type Scan = (signal: AbortSignal) => Promise<Finding[]>;

function setup(scan: Scan, deepScan: DeepScan = () => new Promise<Finding[]>(() => {})) {
  const panel = document.createElement('div');
  const highlightRoot = document.createElement('div');
  document.body.append(panel, highlightRoot);
  const deepScanSpy = vi.fn(deepScan);
  const onUpdate = vi.fn();
  const scanPanel = createScanPanel(panel, { scan, highlightRoot, deepScan: deepScanSpy, onUpdate });
  return { panel, highlightRoot, scanPanel, deepScan: deepScanSpy, onUpdate };
}

function deferredDeepScan() {
  const calls: { signal: AbortSignal; resolve: (findings: Finding[]) => void; reject: (error: unknown) => void }[] = [];
  const deepScan: DeepScan = (signal) =>
    new Promise<Finding[]>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  return { deepScan, calls };
}

function deepButton(panel: HTMLElement): HTMLButtonElement | null {
  return panel.querySelector<HTMLButtonElement>('[data-annotation-deep-scan]');
}

async function flush(): Promise<void> {
  await vi.runAllTimersAsync();
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
  it('drops findings on the host and its descendants and keeps the rest', async () => {
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
    const hit = (await scanPage(window, host, new AbortController().signal, [everything])).map((f) => f.el);
    expect(hit).not.toContain(host);
    expect(hit).not.toContain(child);
    expect(hit).toContain(other);
    expect(hit).toContain(document.body);
  });
});

describe('scan panel', () => {
  it('shows a scanning status and yields a macrotask before scanning', async () => {
    vi.useFakeTimers();
    const scan = vi.fn(async () => [] as Finding[]);
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
    const scan = vi.fn(async () => [finding('a', 'A', 'error', 'x')]);
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

  it('keeps Scanning… while the scan runs; clear() aborts its signal and nothing late renders', async () => {
    vi.useFakeTimers();
    const { deepScan: scan, calls } = deferredDeepScan();
    const { panel, scanPanel } = setup(scan);
    const done = scanPanel.render();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(false);
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scanning…');

    scanPanel.clear();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve([finding('late', 'Late', 'error', 'late')]);
    await flush();
    await done;
    expect(panel.childElementCount).toBe(0);
  });

  it('a newer render() aborts the running scan without showing Scan failed', async () => {
    vi.useFakeTimers();
    const { deepScan: scan, calls } = deferredDeepScan();
    const { panel, scanPanel } = setup(scan);
    const first = scanPanel.render();
    await flush();
    const second = scanPanel.render();
    expect(calls[0]?.signal.aborted).toBe(true);
    await flush();
    await first;
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scanning…');
    calls[1]?.resolve([]);
    await flush();
    await second;
    expect(panel.textContent).not.toContain('Scan failed');
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('0 findings: 0 errors, 0 warnings, 0 advisory');
  });

  it('fails closed with the error message and no list when the scan throws', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel } = setup(async () => {
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
    const { panel, scanPanel } = setup(async () => [finding('a', 'A', 'warning', 'x')]);
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
    const { panel, scanPanel } = setup(async () => findings);
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
    const { panel, highlightRoot, scanPanel } = setup(async () => [finding('r', 'R', 'error', 'a', a), finding('r', 'R', 'error', 'b', b)]);
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
    const { panel, highlightRoot, scanPanel } = setup(async () => [finding('r', 'R', 'error', 'a', a)]);
    await renderNow(scanPanel.render);
    panel.querySelector<HTMLButtonElement>('[data-annotation-scan-locate]')?.click();
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).not.toBeNull();
    scanPanel.clear();
    expect(highlightRoot.querySelector('[data-annotation-scan-highlight]')).toBeNull();
    expect(panel.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('deepScanPage', () => {
  const originalScrollTo = window.scrollTo;
  afterEach(() => {
    window.scrollTo = originalScrollTo;
  });

  it('rejects on abort and runs no rule', async () => {
    const ruleTest = vi.spyOn(hiddenAtRestRules[0]!, 'test');
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(deepScanPage(window, document.createElement('div'), controller.signal)).rejects.toThrow('cancelled');
    expect(ruleTest).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('sweeps, restores the scroll position, then runs the deep-scan rules', async () => {
    vi.useFakeTimers();
    const hidden = document.createElement('p');
    hidden.style.opacity = '0';
    hidden.textContent = 'x'.repeat(300);
    document.body.append(hidden);
    const ruleTest = vi.spyOn(hiddenAtRestRules[0]!, 'test');
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    const pending = deepScanPage(window, document.createElement('div'), new AbortController().signal);
    await vi.runAllTimersAsync();
    const findings = await pending;
    expect(findings.map((f) => f.ruleId)).toContain('content-hidden-at-rest');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: window.scrollY, left: window.scrollX, behavior: 'instant' });
    expect(ruleTest.mock.invocationCallOrder[0]).toBeGreaterThan(scrollTo.mock.invocationCallOrder.at(-1)!);
  });
});

describe('scan panel deep scan', () => {
  it('shows the Deep scan button right after the summary in both result states, and plain render never deep-scans', async () => {
    vi.useFakeTimers();
    const empty = setup(async () => []);
    await renderNow(empty.scanPanel.render);
    const button = deepButton(empty.panel);
    expect(button?.type).toBe('button');
    expect(button?.textContent).toBe('Deep scan (scrolls the page)');
    expect(button?.previousElementSibling?.hasAttribute('data-annotation-scan-summary')).toBe(true);
    expect(empty.deepScan).not.toHaveBeenCalled();

    const full = setup(async () => [finding('a', 'A', 'error', 'x')]);
    await renderNow(full.scanPanel.render);
    expect(deepButton(full.panel)?.previousElementSibling?.hasAttribute('data-annotation-scan-summary')).toBe(true);
    expect(deepButton(full.panel)?.nextElementSibling?.hasAttribute('data-annotation-scan-group')).toBe(true);
    expect(full.deepScan).not.toHaveBeenCalled();
  });

  it('shows no Deep scan button after a failed scan', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel } = setup(async () => {
      throw new Error('boom');
    });
    await renderNow(scanPanel.render);
    expect(deepButton(panel)).toBeNull();
  });

  it('runs: shows a running status and a focused Cancel, then renders prefixed results with Locate', async () => {
    vi.useFakeTimers();
    const target = document.createElement('p');
    document.body.append(target);
    const { deepScan, calls } = deferredDeepScan();
    const { panel, scanPanel, onUpdate, deepScan: spy } = setup(async () => [], deepScan);
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls[0]?.signal.aborted).toBe(false);
    expect([...panel.children].map((el) => el.tagName)).toEqual(['H2', 'P', 'BUTTON']);
    expect(panel.querySelector('h2')?.textContent).toBe('Design scan');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Deep scan running…');
    const cancel = panel.querySelector<HTMLButtonElement>('[data-annotation-deep-scan-cancel]');
    expect(cancel?.type).toBe('button');
    expect(cancel?.textContent).toBe('Cancel');
    expect(document.activeElement).toBe(cancel);
    expect(onUpdate).not.toHaveBeenCalled();

    calls[0]?.resolve([finding('h', 'Hidden', 'error', 'most text hidden', target), finding('w', 'W', 'warning', 'w')]);
    await flush();
    expect(panel.querySelector('[data-annotation-status]')).toBeNull();
    expect(panel.querySelector('[data-annotation-deep-scan-cancel]')).toBeNull();
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('Deep scan: 2 findings: 1 errors, 1 warnings, 0 advisory');
    expect([...panel.querySelectorAll<HTMLElement>('[data-annotation-scan-group]')].map((g) => g.dataset.ruleId)).toEqual(['h', 'w']);
    expect(panel.querySelector('[data-annotation-scan-locate]')?.textContent).toBe('Locate');
    expect(deepButton(panel)?.previousElementSibling?.hasAttribute('data-annotation-scan-summary')).toBe(true);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows the prefixed empty state for a deep scan with no findings', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel } = setup(async () => [], () => Promise.resolve([]));
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();
    await flush();
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('Deep scan: 0 findings: 0 errors, 0 warnings, 0 advisory');
    expect(panel.querySelector('[data-annotation-empty-state]')?.textContent).toBe('No findings on this page.');
    expect(deepButton(panel)).not.toBeNull();
  });

  it('Cancel aborts: shows cancelled with the Deep scan button, no list, and removes the Escape listener', async () => {
    vi.useFakeTimers();
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { deepScan, calls } = deferredDeepScan();
    const { panel, scanPanel, onUpdate } = setup(async () => [], deepScan);
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();
    panel.querySelector<HTMLButtonElement>('[data-annotation-deep-scan-cancel]')?.click();
    await flush();
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Deep scan cancelled');
    expect(deepButton(panel)).not.toBeNull();
    expect(panel.querySelector('[data-annotation-scan-summary]')).toBeNull();
    expect(panel.querySelector('[data-annotation-scan-group]')).toBeNull();
    expect(panel.querySelector('[data-annotation-deep-scan-cancel]')).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('Escape on the document aborts, and a later Escape does nothing', async () => {
    vi.useFakeTimers();
    const { deepScan, calls } = deferredDeepScan();
    const { panel, scanPanel, onUpdate } = setup(async () => [], deepScan);
    await renderNow(scanPanel.render);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onUpdate).not.toHaveBeenCalled();
    deepButton(panel)?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(calls[0]?.signal.aborted).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Deep scan cancelled');

    deepButton(panel)?.click();
    calls[1]?.resolve([]);
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(calls[1]?.signal.aborted).toBe(false);
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('Deep scan: 0 findings: 0 errors, 0 warnings, 0 advisory');
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('fails closed with the error message and no list when the deep scan throws', async () => {
    vi.useFakeTimers();
    const { panel, scanPanel, onUpdate } = setup(async () => [], () => Promise.reject(new Error('sweep broke')));
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();
    await flush();
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Scan failed: sweep broke');
    expect(panel.querySelector('[data-annotation-scan-summary]')).toBeNull();
    expect(panel.querySelector('[data-annotation-scan-group]')).toBeNull();
    expect(panel.querySelector('[data-annotation-empty-state]')).toBeNull();
    expect(deepButton(panel)).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('clear() aborts an in-flight deep scan and drops its late result', async () => {
    vi.useFakeTimers();
    const calls: { signal: AbortSignal; resolve: (findings: Finding[]) => void }[] = [];
    const deepScan: DeepScan = (signal) => new Promise<Finding[]>((resolve) => calls.push({ signal, resolve }));
    const { panel, scanPanel, onUpdate } = setup(async () => [], deepScan);
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();
    scanPanel.clear();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve([finding('late', 'Late', 'error', 'late')]);
    await flush();
    expect(panel.childElementCount).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.childElementCount).toBe(0);
  });

  it('a newer render() aborts an in-flight deep scan and its late result does not land', async () => {
    vi.useFakeTimers();
    const calls: { signal: AbortSignal; resolve: (findings: Finding[]) => void }[] = [];
    const deepScan: DeepScan = (signal) => new Promise<Finding[]>((resolve) => calls.push({ signal, resolve }));
    const { panel, scanPanel, onUpdate } = setup(async () => [], deepScan);
    await renderNow(scanPanel.render);
    deepButton(panel)?.click();
    const rerender = scanPanel.render();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve([finding('late', 'Late', 'error', 'late')]);
    await flush();
    await rerender;
    expect(panel.querySelector('[data-annotation-scan-summary]')?.textContent).toBe('0 findings: 0 errors, 0 warnings, 0 advisory');
    expect(panel.querySelector('[data-annotation-scan-group]')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
