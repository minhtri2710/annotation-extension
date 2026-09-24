import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { buildOverlayShell } from '../ui/shell';
import { createNotePanel } from './note-panel';
import { ScreenshotCaptureError } from '../screenshot/messages';

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
