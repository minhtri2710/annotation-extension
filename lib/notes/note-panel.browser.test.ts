import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { buildOverlayShell } from '../ui/shell';
import { createNotePanel } from './note-panel';
import { ScreenshotCaptureError } from '../screenshot/messages';
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

  it('places the glyph Close at the header end on the heading row', async () => {
    const { shell } = await rendered('light');
    const header = shell.panel.firstElementChild as HTMLElement;
    const heading = header.querySelector('h2')!;
    const close = header.querySelector<HTMLButtonElement>('[data-annotation-close]')!;
    expect(header.matches('[data-annotation-note-header]')).toBe(true);
    const headerRect = header.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    expect(Math.abs(closeRect.top - headingRect.top)).toBeLessThanOrEqual(4);
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

  it('renders card borders and stacked full-width disclosure fields', async () => {
    const { shell } = await rendered('light', {
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
    });
    const card = shell.panel.querySelector<HTMLTextAreaElement>('[data-annotation-edit-note]')!.closest('article')!;
    const labels = [...shell.panel.querySelectorAll<HTMLLabelElement>('[data-annotation-css-group] label, [data-annotation-repro-group] label')];
    const textareas = [...shell.panel.querySelectorAll<HTMLTextAreaElement>('textarea')];
    const form = shell.panel.querySelector<HTMLFormElement>(':scope > form')!;
    expect(getComputedStyle(card).borderTopWidth).toBe('1px');
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
    expect(shadow.activeElement).toBe(shell.panel.querySelector('[data-annotation-new-note]'));
    expect(document.activeElement).not.toBe(document.body);
    expect(notePanel.live.textContent).toBe('Note saved.');
  });

  it('binds visible labels to the fields, names them by position, and words a refused capture', async () => {
    const { shell } = mountShadowPanel();
    const annotation: Annotation = {
      id: '3f2a9c1e-0000-4000-8000-000000000001', pageUrl, note: 'Shot', selector: context.selector,
      elementContext: context, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      status: 'open',
    };
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [annotation],
      sendAnnotationWrite: vi.fn(),
      captureScreenshot: vi.fn().mockRejectedValue(new ScreenshotCaptureError({ kind: 'needs-grant', shortcut: 'Ctrl+Shift+Period' })),
      readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);
    await notePanel.render(context);
    for (const group of shell.panel.querySelectorAll('details')) group.open = true;

    for (const [selector, text] of [
      ['[data-annotation-css-decls]', 'CSS declarations'],
      ['[data-annotation-repro-steps]', 'Reproduction steps'],
      ['[data-annotation-repro-expected]', 'Expected result'],
      ['[data-annotation-repro-actual]', 'Actual result'],
    ] as const) {
      const field = shell.panel.querySelector<HTMLTextAreaElement>(selector)!;
      expect(field.labels?.[0]?.textContent).toBe(text);
      expect(field.labels?.[0]?.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(field.getAttribute('aria-label')).toBe(`${text}, annotation 1`);
    }

    shell.panel.querySelector<HTMLButtonElement>('[data-annotation-capture-screenshot]')!.click();
    await vi.waitFor(() => expect(notePanel.live.textContent).toContain('toolbar icon'));
    expect(notePanel.live.textContent).toContain('Ctrl+Shift+Period');
    expect(notePanel.live.textContent).not.toContain('permission is required');
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

  it('sniffs a picked file by its bytes: a JPEG named .png attaches as image/jpeg, non-image bytes are refused', async () => {
    const { shell } = mountShadowPanel();
    const annotation: Annotation = {
      id: 'a1', pageUrl, note: 'Files', selector: context.selector, elementContext: context,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', status: 'open',
    };
    const addAttachment = vi.fn().mockResolvedValue({ id: 'b1', name: 'photo.png', mimeType: 'image/jpeg', byteLength: 7 });
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => [annotation],
      sendAnnotationWrite: vi.fn(), captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment, deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    await notePanel.render(context);
    const pick = (file: File) => {
      const input = shell.panel.querySelector<HTMLInputElement>('[data-annotation-attachment-input]')!;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    };

    pick(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'photo.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(addAttachment).toHaveBeenCalledTimes(1));
    expect(addAttachment.mock.calls[0]?.[0]).toMatchObject({ name: 'photo.png', mimeType: 'image/jpeg' });

    pick(new File(['<svg onload=alert(1)>'], 'fake.png', { type: 'image/png' }));
    await vi.waitFor(() =>
      expect(shell.panel.querySelector('[data-annotation-status]')?.textContent).toBe('fake.png is not a PNG, JPEG or WebP image.'),
    );
    expect(addAttachment).toHaveBeenCalledTimes(1);
  });
});
