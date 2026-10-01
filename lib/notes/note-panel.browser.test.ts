import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { formatElementContext } from '../export/format';
import { buildOverlayShell } from '../ui/shell';
import { createNotePanel } from './note-panel';
import { contrastRatio, parseColor } from '../lint/color';
import { applyThemeMode, type ThemeMode } from '../ui/theme';

const pageUrl = 'https://example.com/article';
const context: ElementContext = {
  selector: '#target', tagName: 'BUTTON', id: 'target', classList: [], text: 'Target',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: pageUrl,
  viewport: { width: 1280, height: 720 }, sourcePath: null,
};

function mountShadowPanel() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  return { shadow, shell: buildOverlayShell(container) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('note panel in a real browser', () => {
  async function rendered(theme: ThemeMode, overrides: Partial<Annotation> = {}) {
    const { shadow, shell } = mountShadowPanel();
    applyThemeMode(shell.root, theme);
    const annotation: Annotation = {
      id: 'layout', pageUrl, note: 'Card', selector: context.selector, elementContext: context,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', status: 'open',
      ...overrides,
    };
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [annotation],
      sendAnnotationWrite: vi.fn(), captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);
    await notePanel.render(context);
    return { shadow, shell, notePanel };
  }

  it('places the glyph Close at the header end on the element label row', async () => {
    const { shell } = await rendered('light');
    const header = shell.panel.firstElementChild as HTMLElement;
    const hint = header.querySelector('[data-annotation-hint]')!;
    const close = header.querySelector<HTMLButtonElement>('[data-annotation-close]')!;
    expect(header.matches('[data-annotation-note-header]')).toBe(true);
    const headerRect = header.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    expect(Math.abs((closeRect.top + closeRect.height / 2) - (hintRect.top + hintRect.height / 2))).toBeLessThanOrEqual(4);
    expect(closeRect.right).toBeCloseTo(headerRect.right - Number.parseFloat(getComputedStyle(header).paddingRight), 0);
    expect(closeRect.width).toBeGreaterThanOrEqual(32);
    expect(closeRect.height).toBeGreaterThanOrEqual(32);
  });

  it('keeps the attachment input tabbable and rings only for keyboard focus', async () => {
    const { shadow, shell } = await rendered('light');
    const input = shell.panel.querySelector<HTMLInputElement>('[data-annotation-attachment-input]')!;
    const attach = shell.panel.querySelector<HTMLLabelElement>('[data-annotation-attach]')!;
    input.addEventListener('click', (event) => event.preventDefault());
    expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(input.getBoundingClientRect().height).toBeLessThanOrEqual(1);
    expect(getComputedStyle(attach).height).toBe('32px');
    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-capture-screenshot]')!.focus();
    await userEvent.tab();
    expect(shadow.activeElement).toBe(input);
    expect(getComputedStyle(attach).outlineStyle).not.toBe('none');
    expect(getComputedStyle(attach).outlineWidth).toBe('2px');
    await userEvent.click(attach);
    expect(shadow.activeElement).toBe(input);
    expect(getComputedStyle(attach).outlineStyle).toBe('none');
  });

  it('centres note card disclosure summary text while preserving its marker display', async () => {
    const { shell } = await rendered('light', {
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
    });
    const summary = shell.panel.querySelector<HTMLDetailsElement>('[data-annotation-css-group] summary')!;
    const rect = summary.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(summary);
    const textRect = range.getBoundingClientRect();
    expect(getComputedStyle(summary).display).toBe('list-item');
    expect(rect.height).toBeGreaterThanOrEqual(32);
    expect(Math.abs((textRect.top + textRect.height / 2) - (rect.top + rect.height / 2))).toBeLessThanOrEqual(2);
  });

  it('renders a card without a border or padding of its own and stacked full-width disclosure fields', async () => {
    const { shell } = await rendered('light', {
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
    });
    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-add-another]')!.click();
    const card = shell.panel.querySelector<HTMLTextAreaElement>('[data-annotation-edit-note]')!.closest('article')!;
    const labels = [...shell.panel.querySelectorAll<HTMLLabelElement>('[data-annotation-css-group] label, [data-annotation-repro-group] label')];
    const textareas = [...shell.panel.querySelectorAll<HTMLTextAreaElement>('textarea')];
    const form = shell.panel.querySelector<HTMLFormElement>(':scope > form')!;
    expect(getComputedStyle(card).borderTopWidth).toBe('0px');
    expect(getComputedStyle(card).paddingTop).toBe('0px');
    expect(card.getBoundingClientRect().height).toBeGreaterThan(0);
    for (const label of labels) {
      const field = label.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(getComputedStyle(label).display).toBe('flex');
      expect(getComputedStyle(label).flexDirection).toBe('column');
      expect(field.getBoundingClientRect().width).toBeGreaterThanOrEqual(card.getBoundingClientRect().width * 0.9);
      expect(field.getBoundingClientRect().top).toBeGreaterThan(label.getBoundingClientRect().top);
    }
    for (const field of textareas) {
      expect(getComputedStyle(field).boxSizing).toBe('border-box');
      expect(field.getBoundingClientRect().height).toBeGreaterThanOrEqual(3 * Number.parseFloat(getComputedStyle(field).lineHeight));
      expect(getComputedStyle(field).resize).toBe('vertical');
    }
    expect(getComputedStyle(form).borderTopWidth).toBe('1px');
    expect(getComputedStyle(form).borderTopStyle).toBe('solid');
  });

  it.each<ThemeMode>(['light', 'dark'])('keeps the new-note placeholder at 4.5:1 in the %s theme', async (theme) => {
    const { shell } = await rendered(theme);
    const note = shell.panel.querySelector<HTMLTextAreaElement>('[data-annotation-new-note]')!;
    const styles = getComputedStyle(note);
    const placeholder = getComputedStyle(note, '::placeholder');
    const muted = getComputedStyle(shell.root).getPropertyValue('--annotation-color-text-muted').trim();
    const parsedText = parseColor(placeholder.color);
    const parsedMuted = parseColor(muted);
    const parsedSurface = parseColor(styles.backgroundColor);
    expect(parsedText).toBeDefined();
    expect(parsedMuted).toBeDefined();
    expect(parsedText).toEqual(parsedMuted);
    expect(parsedSurface).toBeDefined();
    expect(contrastRatio(parsedText!, parsedSurface!)).toBeGreaterThanOrEqual(4.5);
    expect(note.placeholder).toBe('What should change here?');
  });
  it('focuses the new-note field on open, saves on a real Ctrl+Enter, keeps focus, and announces an empty save', async () => {
    const { shadow, shell } = mountShadowPanel();
    const stored: Annotation[] = [];
    const sendAnnotationWrite = vi.fn(async () => {
      stored.push({
        id: `a${stored.length + 1}`, pageUrl, note: 'Typed note', selector: context.selector, elementContext: context,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', status: 'open',
      });
    });
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [...stored],
      sendAnnotationWrite,
      captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);

    await notePanel.render(context);
    expect(shadow.activeElement).toBe(shell.panel.querySelector('[data-annotation-new-note]'));

    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect(notePanel.live.textContent).toBe('Write a note before saving.');
    expect(notePanel.live.getAttribute('role')).toBe('status');

    await userEvent.keyboard('Typed note');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => expect(shell.panel.querySelector('[data-annotation-edit-note]')).not.toBeNull());
    expect(sendAnnotationWrite).toHaveBeenCalledTimes(1);
    // The saved note folds the form behind Add another note, so focus moves to the panel heading.
    expect(shadow.activeElement).toBe(shell.panel.querySelector('h2'));
    expect(document.activeElement).not.toBe(document.body);
    expect(notePanel.live.textContent).toBe('Note saved.');
  });

  it('lays out visible labels for the CSS and repro fields', async () => {
    const { shell } = await rendered('light');
    for (const group of shell.panel.querySelectorAll('details')) group.open = true;

    for (const selector of [
      '[data-annotation-css-decls]',
      '[data-annotation-repro-steps]',
      '[data-annotation-repro-expected]',
      '[data-annotation-repro-actual]',
    ]) {
      const field = shell.panel.querySelector<HTMLTextAreaElement>(selector)!;
      expect(field.labels?.[0]?.getBoundingClientRect().height).toBeGreaterThan(0);
    }
  });

  const LONG_TEXT = 'A long visible text inside the annotated element that cannot fit on one line of the panel '.repeat(3).trim();
  const rect = (element: Element) => element.getBoundingClientRect();
  const alpha = (value: string) => parseColor(value)!.a;

  it('names the element on one truncated line with its full label on hover', async () => {
    const { shadow, shell } = mountShadowPanel();
    const long: ElementContext = { ...context, text: LONG_TEXT };
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [], sendAnnotationWrite: vi.fn(), captureScreenshot: vi.fn(), readBlob: vi.fn(),
      addAttachment: vi.fn(), deleteAttachment: vi.fn(), applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    await notePanel.render(long);
    const hint = shell.panel.querySelector<HTMLElement>('[data-annotation-hint]')!;
    const style = getComputedStyle(hint);
    expect(rect(hint).height).toBeLessThan(Number.parseFloat(style.lineHeight) * 1.5);
    expect(style.textOverflow).toBe('ellipsis');
    expect(hint.scrollWidth).toBeGreaterThan(hint.clientWidth);
    const label = formatElementContext(long)!;
    expect(hint.textContent).toBe(label);
    const hovered = shadow.elementFromPoint(rect(hint).left + 8, rect(hint).top + rect(hint).height / 2);
    expect(hovered?.closest('[title]')?.getAttribute('title')).toContain(label);
  });

  it('sets Capture screenshot and Attach image as a quieter row under the note, Delete, Resolve and Save as one footer row with Save last, and shorter CSS and repro fields', async () => {
    const { shell } = await rendered('light');
    for (const group of shell.panel.querySelectorAll('details')) group.open = true;
    const part = (selector: string) => shell.panel.querySelector<HTMLElement>(selector)!;
    const [save, resolve, capture, attach, remove] = ['[data-annotation-edit]', '[data-annotation-status-toggle]', '[data-annotation-capture-screenshot]', '[data-annotation-attach]', '[data-annotation-delete]'].map(part);
    const actions = part('[data-annotation-note-actions]');
    expect(rect(capture!).top).toBeGreaterThanOrEqual(rect(part('[data-annotation-edit-note]')).bottom);
    expect(Math.abs(rect(capture!).top - rect(attach!).top)).toBeLessThanOrEqual(1);
    expect(rect(capture!).right).toBeLessThanOrEqual(rect(attach!).left);
    expect(rect(actions).top).toBeGreaterThanOrEqual(rect(part('[data-annotation-css-group]')).bottom);
    for (const button of [remove!, resolve!, save!]) expect(Math.abs(rect(button).top - rect(save!).top)).toBeLessThanOrEqual(1);
    expect(rect(remove!).right + 24).toBeLessThanOrEqual(rect(resolve!).left);
    expect(rect(resolve!).right).toBeLessThanOrEqual(rect(save!).left);
    expect(rect(actions).right - rect(save!).right).toBeLessThanOrEqual(1);
    for (const button of [save!, resolve!, capture!, attach!, remove!]) expect(getComputedStyle(button).borderTopWidth).toBe('0px');
    expect(alpha(getComputedStyle(save!).backgroundColor)).toBe(1);
    expect(alpha(getComputedStyle(capture!).backgroundColor)).toBe(0);
    expect(alpha(getComputedStyle(attach!).backgroundColor)).toBe(0);
    expect(alpha(getComputedStyle(remove!).backgroundColor)).toBe(0);

    const note = part('[data-annotation-edit-note]');
    for (const selector of ['[data-annotation-css-decls]', '[data-annotation-repro-steps]', '[data-annotation-repro-expected]', '[data-annotation-repro-actual]']) {
      expect(rect(part(selector)).height, selector).toBeLessThan(rect(note).height);
    }

    const accent = parseColor(getComputedStyle(shell.root).getPropertyValue('--annotation-color-accent').trim());
    expect(parseColor(getComputedStyle(save!).backgroundColor)).toEqual(accent);
    expect(parseColor(getComputedStyle(part('[data-annotation-save]')).backgroundColor)).not.toEqual(accent);
  });

  it('starts an emptied CSS group closed after the real initial toggle event of its content-opened render', async () => {
    const { shell } = mountShadowPanel();
    const annotation: Annotation = {
      id: '3f2a9c1e-0000-4000-8000-000000000002', pageUrl, note: 'Styled', selector: context.selector,
      elementContext: context, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      status: 'open', cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
    };
    let stored = [annotation];
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => stored,
      sendAnnotationWrite: vi.fn(),
      captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    const cssGroup = () => shell.panel.querySelector<HTMLDetailsElement>('[data-annotation-css-group]')!;
    await notePanel.render(context);
    expect(cssGroup().open).toBe(true);
    for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);

    stored = [{ ...annotation, cssEdits: [] }];
    notePanel.clear();
    await notePanel.render(context);
    expect(cssGroup().open).toBe(false);
  });

});
