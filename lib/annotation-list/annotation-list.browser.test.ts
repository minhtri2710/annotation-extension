import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { formatElementContext } from '../export/format';
import { parseColor } from '../lint/color';
import { buildOverlayShell } from '../ui/shell';
import { createAnnotationList } from './annotation-list';

const pageUrl = 'https://example.com/article';

function annotation(id: string, selector: string): Annotation {
  const elementContext: ElementContext = {
    selector, tagName: 'P', id, classList: [], text: '', boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    url: pageUrl, viewport: { width: 1280, height: 720 }, sourcePath: null,
  };
  return {
    id, pageUrl, note: `Note ${id}`, selector, elementContext,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', status: 'open',
  };
}

afterEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('annotation list in a real browser', () => {
  it('Locate scrolls a far element into view with a highlight; a stale anchor moves nothing', async () => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    const target = document.createElement('p');
    target.id = 'far-target';
    target.textContent = 'Far away';
    const host = document.createElement('div');
    document.body.append(spacer, target, host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    const shell = buildOverlayShell(container);
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [annotation('a1', '#far-target'), annotation('a2', '#gone')],
      sendAnnotationWrite: vi.fn(), readBlob: vi.fn(),
      readOnboardingOpen: async () => false, writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    shell.root.append(list.live);
    await list.render();
    expect(window.scrollY).toBe(0);

    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-id="a2"] [data-annotation-locate]')!.click();
    expect(window.scrollY).toBe(0);
    expect(list.live.textContent).toBe('Element not found on this page');

    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-id="a1"] [data-annotation-locate]')!.click();
    expect(window.scrollY).toBeGreaterThan(1000);
    const rect = target.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    const highlight = shell.root.querySelector<HTMLElement>('[data-annotation-scan-highlight]');
    expect(highlight?.style.top).toBe(`${rect.top}px`);
    list.clear();
  });

  it('spaces row and export action buttons and places Clear all below the rows', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    const shell = buildOverlayShell(container);
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [annotation('a1', '#missing'), annotation('a2', '#missing')],
      sendAnnotationWrite: vi.fn(), readBlob: vi.fn(),
      readOnboardingOpen: async () => false, writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    await list.render();
    const gapAtLeastSpace2 = (actions: HTMLElement, count: number) => {
      const buttons = [...actions.querySelectorAll('button')];
      expect(buttons).toHaveLength(count);
      for (let index = 1; index < buttons.length; index += 1) {
        expect(buttons[index]!.getBoundingClientRect().left - buttons[index - 1]!.getBoundingClientRect().right).toBeGreaterThanOrEqual(8);
        expect(buttons[index - 1]!.getBoundingClientRect().right).toBeLessThanOrEqual(buttons[index]!.getBoundingClientRect().left);
      }
    };
    gapAtLeastSpace2(shell.panel.querySelector<HTMLElement>('[data-annotation-row-actions]')!, 3);
    gapAtLeastSpace2(shell.panel.querySelector<HTMLElement>('[data-annotation-export-actions]')!, 2);
    const rows = shell.panel.querySelector<HTMLElement>('[data-annotation-rows]')!;
    const footer = shell.panel.querySelector<HTMLElement>('[data-annotation-list-footer]')!;
    const clear = footer.querySelector<HTMLButtonElement>('[data-annotation-clear]')!;
    expect(footer.previousElementSibling).toBe(rows);
    expect(footer.getBoundingClientRect().top).toBeGreaterThan(rows.getBoundingClientRect().bottom);
    const footerStyle = getComputedStyle(footer);
    expect(footerStyle.borderTopWidth).toBe('1px');
    expect(parseColor(footerStyle.borderTopColor)).toEqual(parseColor(getComputedStyle(shell.root).getPropertyValue('--annotation-color-divider')));
    const clearStyle = getComputedStyle(clear);
    expect(clearStyle.borderTopColor).toBe(clearStyle.borderBottomColor);
    expect(clear.getBoundingClientRect().height).toBe(shell.panel.querySelector<HTMLButtonElement>('[data-annotation-row-actions] [data-annotation-locate]')!.getBoundingClientRect().height);
    list.clear();
  });

  async function renderedList(annotations: Annotation[], onboardingOpen: boolean) {
    const target = document.createElement('p');
    target.id = 'labelled';
    target.textContent = 'Target';
    const host = document.createElement('div');
    document.body.append(target, host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    const shell = buildOverlayShell(container);
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => annotations,
      sendAnnotationWrite: vi.fn(), readBlob: vi.fn(),
      readOnboardingOpen: async () => onboardingOpen, writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    await list.render();
    return { shadow, shell, list };
  }

  const LONG_TEXT = 'A long visible text inside the annotated element that cannot fit on one line of the panel '.repeat(3).trim();
  const longLabelled = (id: string): Annotation => {
    const base = annotation(id, '#labelled');
    return { ...base, elementContext: { ...base.elementContext, tagName: 'DIV', id: 'labelled', text: LONG_TEXT } };
  };
  const rect = (element: Element) => element.getBoundingClientRect();
  const sharesLine = (a: Element, b: Element) => rect(a).top < rect(b).bottom && rect(b).top < rect(a).bottom;

  it('orders the header, How it works with its stored open state, the filter, the rows and a footer with the export and Clear all buttons', async () => {
    for (const open of [true, false]) {
      const { shell, list } = await renderedList([annotation('a1', '#labelled'), annotation('a2', '#labelled')], open);
      const part = (selector: string) => shell.panel.querySelector<HTMLElement>(selector)!;
      const header = part('[data-annotation-list-header]');
      const filter = part('[data-annotation-filter]');
      const rows = part('[data-annotation-rows]');
      const footer = part('[data-annotation-list-footer]');
      const onboarding = part('[data-annotation-onboarding]');
      expect(rect(header).bottom).toBeLessThanOrEqual(rect(filter).top);
      if (open) {
        expect(rect(header).bottom).toBeLessThanOrEqual(rect(onboarding).top);
        expect(rect(onboarding).bottom).toBeLessThanOrEqual(rect(filter).top);
      }
      expect(rect(filter).bottom).toBeLessThanOrEqual(rect(rows).top);
      expect(rect(rows).bottom).toBeLessThanOrEqual(rect(footer).top);
      expect([...footer.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Copy Markdown', 'Download', 'Clear all']);
      expect(onboarding.hidden).toBe(!open);
      expect(rect(onboarding).height > 0).toBe(open);
      list.clear();
      document.body.replaceChildren();
    }
  });

  it('puts a row number, note and the icon actions on one line, the element label on one truncated line with its full text on hover, and the status under the note', async () => {
    const { shadow, shell, list } = await renderedList([longLabelled('a1')], false);
    const row = shell.panel.querySelector<HTMLElement>('[data-annotation-row]')!;
    const number = row.querySelector('[data-annotation-position]')!;
    const note = row.querySelector('[data-annotation-note]')!;
    const actions = row.querySelector('[data-annotation-row-actions]')!;
    const status = row.querySelector('[data-annotation-status]')!;
    expect(sharesLine(number, note) && sharesLine(note, actions)).toBe(true);
    expect(rect(number).right).toBeLessThanOrEqual(rect(note).left);
    expect(rect(note).right).toBeLessThanOrEqual(rect(actions).left);
    expect(rect(status).top).toBeGreaterThanOrEqual(rect(note).bottom);

    const hint = row.querySelector<HTMLElement>('[data-annotation-hint]')!;
    const style = getComputedStyle(hint);
    expect(rect(hint).top).toBeGreaterThanOrEqual(rect(note).bottom);
    expect(rect(hint).height).toBeLessThan(Number.parseFloat(style.lineHeight) * 1.5);
    expect(style.textOverflow).toBe('ellipsis');
    expect(hint.scrollWidth).toBeGreaterThan(hint.clientWidth);
    const label = formatElementContext(longLabelled('a1').elementContext)!;
    expect(hint.textContent).toBe(label);
    const hovered = shadow.elementFromPoint(rect(hint).left + 8, rect(hint).top + rect(hint).height / 2);
    expect(hovered?.closest('[title]')?.getAttribute('title')).toContain(label);

    const [locate, edit, remove] = ['[data-annotation-locate]', '[data-annotation-row-edit]', '[data-annotation-delete]'].map((selector) => rect(row.querySelector(selector)!));
    expect(edit!.left - locate!.right).toBeGreaterThanOrEqual(8);
    expect(remove!.left - edit!.right).toBeGreaterThanOrEqual(8);
    for (const box of [locate, edit, remove]) expect([box!.width, box!.height]).toEqual([32, 32]);
    list.clear();
  });

  it('puts the status chip at the end of the element label line, centred with the label, and keeps each row two lines tall', async () => {
    const { shell, list } = await renderedList([longLabelled('a1'), { ...longLabelled('a2'), status: 'resolved' }], false);
    const rows = [...shell.panel.querySelectorAll<HTMLElement>('[data-annotation-row]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const hint = row.querySelector<HTMLElement>('[data-annotation-hint]')!;
      const status = row.querySelector<HTMLElement>('[data-annotation-status]')!;
      const actions = row.querySelector<HTMLElement>('[data-annotation-row-actions]')!;
      const centre = (element: Element) => rect(element).top + rect(element).height / 2;
      expect(Math.abs(centre(status) - centre(hint))).toBeLessThanOrEqual(2);
      expect(rect(hint).right).toBeLessThanOrEqual(rect(status).left);
      expect(hint.scrollWidth).toBeGreaterThan(hint.clientWidth);
      const style = getComputedStyle(row);
      const secondLine = Math.max(rect(hint).height, rect(status).height);
      const twoLines = rect(actions).height + Number.parseFloat(style.rowGap) + secondLine
        + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth);
      expect(rect(row).height).toBeLessThanOrEqual(twoLines + 1);
    }
    list.clear();
  });

  it('names the stub capture shortcut in the first How it works step', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    const shell = buildOverlayShell(container);
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [],
      sendAnnotationWrite: vi.fn(), readBlob: vi.fn(),
      readOnboardingOpen: async () => true, writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    await list.render();

    const first = shell.panel.querySelector<HTMLElement>('[data-annotation-onboarding] li');
    expect(first?.textContent).toBe('Click Annotate or press Alt+Q, then click any element to leave a note.');
    expect(first?.getBoundingClientRect().height).toBeGreaterThan(0);
    list.clear();
  });
});
