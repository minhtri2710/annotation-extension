// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import { MAX_TEXT_LENGTH, type AnnotationWriteMessage } from '../annotation-messages';
import type { ElementContext } from '../capture/context';
import { createNotePanel, NOTE_PANEL_CLOSE_EVENT } from './note-panel';
import type { NotePanelPersistence } from './persistence';
import { ScreenshotCaptureError } from '../screenshot/messages';

const pageUrl = 'https://example.com/article';
const context: ElementContext = {
  selector: '#target',
  tagName: 'BUTTON',
  id: 'target',
  classList: ['primary'],
  text: 'Target',
  boundingBox: { x: 1, y: 2, width: 100, height: 40 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

function annotation(note: string): Annotation {
  return {
    id: 'annotation-1',
    pageUrl,
    note,
    selector: context.selector,
    elementContext: context,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
  };
}

async function render(
  panel: HTMLDivElement,
  annotations: Annotation[] = [],
  persistence?: Partial<NotePanelPersistence>,
) {
  const listAnnotations = persistence?.listAnnotations ?? vi.fn().mockResolvedValue(annotations);
  const sendAnnotationWrite = persistence?.sendAnnotationWrite ?? vi.fn().mockResolvedValue(undefined);
  const captureScreenshot = persistence?.captureScreenshot ?? vi.fn();
  const readBlob = persistence?.readBlob ?? vi.fn().mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
  const applyCssEdits = persistence?.applyCssEdits ?? vi.fn();
  const revertCssEdits = persistence?.revertCssEdits ?? vi.fn();
  const revertAllCssEdits = persistence?.revertAllCssEdits ?? vi.fn();
  const notePanel = createNotePanel(panel, {
    listAnnotations,
    sendAnnotationWrite,
    captureScreenshot,
    readBlob,
    addAttachment: persistence?.addAttachment ?? vi.fn().mockResolvedValue({}),
    deleteAttachment: persistence?.deleteAttachment ?? vi.fn().mockResolvedValue(true),
    applyCssEdits,
    revertCssEdits,
    revertAllCssEdits,
  });
  await notePanel.render(context);
  return {
    listAnnotations,
    sendAnnotationWrite,
    captureScreenshot,
    readBlob,
    addAttachment: persistence?.addAttachment ?? vi.fn().mockResolvedValue({}),
    deleteAttachment: persistence?.deleteAttachment ?? vi.fn().mockResolvedValue(true),
    applyCssEdits,
    revertCssEdits,
    revertAllCssEdits,
    notePanel,
  };
}

describe('note panel', () => {
  it('renders matching annotations with note text and edit/delete controls', async () => {
    const panel = document.createElement('div');
    const matching = annotation('Existing note');
    const other = { ...annotation('Other element'), id: 'annotation-2', selector: '.other' };
    const listAnnotations = vi.fn().mockResolvedValue([matching, other]);

    await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    });

    const item = panel.querySelector('[data-annotation-id="annotation-1"]');
    expect(item).not.toBeNull();
    expect((item?.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement).value).toBe(
      'Existing note',
    );
    expect(panel.textContent).not.toContain('Other element');
    expect(item?.querySelector('[data-annotation-edit]')).not.toBeNull();
    expect(item?.querySelector('[data-annotation-delete]')).not.toBeNull();
  });

  it('adds a note with the exact write message and re-reads storage', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = 'New note';
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));

    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.add',
      pageUrl,
      input: { note: 'New note', selector: context.selector, elementContext: context },
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('keeps render resolved when listing annotations fails', async () => {
    const panel = document.createElement('div');
    const notePanel = createNotePanel(panel, {
      listAnnotations: vi.fn().mockRejectedValue(new Error('list failed')),
      sendAnnotationWrite: vi.fn(),
      captureScreenshot: vi.fn(),
      readBlob: vi.fn(),
      addAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(),
      revertCssEdits: vi.fn(),
      revertAllCssEdits: vi.fn(),
    });
    await expect(notePanel.render(context)).resolves.toBeUndefined();
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('list failed');
    expect(panel.querySelector('[data-annotation-new-note]')).not.toBeNull();
  });

  it('shows a write error and keeps the note form after a rejected save', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockRejectedValue(new Error('write failed'));
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = 'Keep this form';
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(panel.textContent).toContain('write failed'));
    expect(panel.querySelector('[data-annotation-new-note]')).not.toBeNull();
  });

  it('scopes failure status to the selected element', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockRejectedValue(new Error('write failed'));
    const { notePanel } = await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = 'Fail on A';
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.textContent).toContain('write failed'));

    await notePanel.render(context);
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('write failed');

    const contextB = { ...context, selector: '#other', id: 'other' };
    await notePanel.render(contextB);
    expect(panel.querySelector('[data-annotation-status]')).toBeNull();
  });

  it('shows a capture error and keeps the annotation item after capture rejects', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Capture failure');
    const captureScreenshot = vi.fn().mockRejectedValue(new Error('capture failed'));
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot,
    });

    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(panel.textContent).toContain('capture failed'));
    expect(panel.querySelector(`[data-annotation-id="${existing.id}"]`)).not.toBeNull();
    expect(panel.querySelector('[data-annotation-screenshot]')).toBeNull();
  });

  it('shows a capture write error and keeps the annotation item', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Capture write failure');
    const captureScreenshot = vi.fn().mockRejectedValue(new Error('capture write failed'));
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot,
    });

    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(panel.textContent).toContain('capture write failed'));
    expect(panel.querySelector(`[data-annotation-id="${existing.id}"]`)).not.toBeNull();
  });

  it('captures through the persistence seam and relies on background metadata update', async () => {
    const panel = document.createElement('div');
    const existing = annotation('With screenshot control');
    const listAnnotations = vi.fn().mockResolvedValue([existing]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const captureScreenshot = vi.fn().mockResolvedValue({
      mimeType: 'image/webp', width: 800, height: 400, byteLength: 12,
    });
    const { captureScreenshot: capture } = await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot,
    });

    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));

    expect(capture).toHaveBeenCalledWith(existing, context);
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('applies and saves parsed css edits once, then re-reads storage', async () => {
    const panel = document.createElement('div');
    const existing = annotation('CSS target');
    const listAnnotations = vi.fn().mockResolvedValue([existing]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const cssEdits = [
      { property: 'color', value: 'red', original: 'rgb(0, 0, 0)' },
      { property: 'margin', value: '1rem: extra', original: '0px' },
    ];
    const applyCssEdits = vi.fn().mockReturnValue(cssEdits);
    const { applyCssEdits: apply } = await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      applyCssEdits,
    });

    (panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value =
      '  color: red  \n\ninvalid line\n margin : 1rem: extra \n : missing-property \n padding:   ';
    (panel.querySelector('[data-annotation-css-save]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith(existing, [
      { property: 'color', value: 'red' },
      { property: 'margin', value: '1rem: extra' },
    ]);
    expect(sendAnnotationWrite).toHaveBeenCalledTimes(1);
    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.update',
      pageUrl,
      id: existing.id,
      changes: { cssEdits },
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('re-applies stored css edits when an annotation renders', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Saved CSS'),
      cssEdits: [
        { property: 'color', value: 'red', original: 'rgb(0, 0, 0)' },
        { property: 'display', value: 'block', original: 'inline' },
      ],
    };
    const applyCssEdits = vi.fn();
    const { applyCssEdits: apply } = await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
      applyCssEdits,
    });

    expect(apply).toHaveBeenCalledWith(existing, existing.cssEdits);
  });

  it('renders saved css edit read-out and clear control', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Saved CSS'),
      cssEdits: [
        { property: 'color', value: 'red', original: 'rgb(0, 0, 0)' },
        { property: 'display', value: 'block', original: 'inline' },
      ],
    };
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    });

    const readout = panel.querySelector('[data-annotation-css]');
    expect(readout).not.toBeNull();
    expect(readout?.textContent).toContain('color: rgb(0, 0, 0) -> red');
    expect(readout?.textContent).toContain('display: inline -> block');
    expect(panel.querySelector('[data-annotation-css-clear]')).not.toBeNull();
    expect((panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value)
      .toBe('color: red\ndisplay: block');
  });

  it('fails closed without saving when the element is not live', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const applyCssEdits = vi.fn().mockReturnValue(undefined);
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([annotation('Detached')]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      applyCssEdits,
    });

    (panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value = 'color: red';
    (panel.querySelector('[data-annotation-css-save]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect(panel.querySelector('[data-annotation-status]')?.textContent)
      .toBe('Element not found on this page; CSS tweaks were not saved.');
  });

  it('does not render the clear control for empty or missing css edits', async () => {
    const panel = document.createElement('div');
    const empty = { ...annotation('Empty CSS'), cssEdits: [] };
    const missing = annotation('Missing CSS');
    const listAnnotations = vi.fn().mockResolvedValue([empty]);
    const { notePanel } = await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    });
    expect(panel.querySelector('[data-annotation-css-clear]')).toBeNull();

    listAnnotations.mockResolvedValue([missing]);
    await notePanel.render(context);
    expect(panel.querySelector('[data-annotation-css-clear]')).toBeNull();
  });

  it('clears css edits, persists the empty set, and re-reads storage', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Clear CSS'),
      cssEdits: [{ property: 'color', value: 'red', original: 'rgb(0, 0, 0)' }],
    };
    const listAnnotations = vi.fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const revertCssEdits = vi.fn();
    const { revertCssEdits: revert } = await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      revertCssEdits,
    });

    (panel.querySelector('[data-annotation-css-clear]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));

    expect(revert).toHaveBeenCalledWith(existing);
    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.update',
      pageUrl,
      id: existing.id,
      changes: { cssEdits: [] },
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
    expect(panel.querySelector('[data-annotation-css]')).toBeNull();
    expect(panel.querySelector('[data-annotation-css-clear]')).toBeNull();
  });

  it('tears down all applied css edits through persistence', async () => {
    const panel = document.createElement('div');
    const revertAllCssEdits = vi.fn();
    const { notePanel, revertAllCssEdits: revertAll } = await render(panel, [], {
      revertAllCssEdits,
    });

    notePanel.teardown();

    expect(revertAll).toHaveBeenCalledTimes(1);
  });

  it('does not apply or save css edits when every line is invalid or blank', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const applyCssEdits = vi.fn();
    const { applyCssEdits: apply } = await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([annotation('Empty CSS')]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      applyCssEdits,
    });

    (panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value =
      '\nblank only\n: missing property\nproperty:   ';
    (panel.querySelector('[data-annotation-css-save]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(apply).not.toHaveBeenCalled();
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('saves a trimmed repro once and re-reads storage', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Repro target');
    const listAnnotations = vi.fn().mockResolvedValue([existing]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    (panel.querySelector('[data-annotation-repro-steps]') as HTMLTextAreaElement).value =
      '  Open page  \n\n Click button  \n';
    (panel.querySelector('[data-annotation-repro-expected]') as HTMLTextAreaElement).value =
      ' Dialog opens ';
    (panel.querySelector('[data-annotation-repro-actual]') as HTMLTextAreaElement).value =
      ' Nothing happens ';
    (panel.querySelector('[data-annotation-repro-save]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.update',
      pageUrl,
      id: existing.id,
      changes: {
        repro: {
          steps: ['Open page', 'Click button'],
          expected: 'Dialog opens',
          actual: 'Nothing happens',
        },
      },
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('renders a saved repro read-out', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Saved repro'),
      repro: { steps: ['Open page', 'Click button'], expected: 'Dialog opens', actual: 'Nothing happens' },
    };
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    });

    const readout = panel.querySelector('[data-annotation-repro]');
    expect(readout).not.toBeNull();
    expect(readout?.querySelectorAll('ol > li')).toHaveLength(2);
    expect(readout?.textContent).toContain('Open page');
    expect(readout?.textContent).toContain('Click button');
    expect(readout?.textContent).toContain('Expected: Dialog opens');
    expect(readout?.textContent).toContain('Actual: Nothing happens');
  });

  it('does not save an all-empty repro', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([annotation('Empty repro')]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    (panel.querySelector('[data-annotation-repro-save]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('reads an existing screenshot Blob and renders a revoked-on-rerender object URL', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Preview me'),
      screenshot: { mimeType: 'image/png', width: 10, height: 10, byteLength: 7 },
    };
    const createObjectURL = vi.fn().mockReturnValue('blob:preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const { notePanel, readBlob } = await render(panel, [existing], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
      readBlob: vi.fn().mockResolvedValue(new Blob(['existing'], { type: 'image/png' })),
    });

    const preview = panel.querySelector('[data-annotation-screenshot]') as HTMLImageElement;
    expect(preview).not.toBeNull();
    expect(preview.src).toContain('blob:preview');
    expect(readBlob).toHaveBeenCalledWith(`screenshot:${existing.id}`);
    await notePanel.render(context);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    vi.unstubAllGlobals();
  });

  it('shows attachment controls, previews names safely, and reports attachment read errors', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Attachment note'),
      attachments: [{ id: 'attachment-1', name: '<img src=x>', mimeType: 'image/png', byteLength: 7 }],
    };
    const readBlob = vi.fn().mockResolvedValue(new Blob(['attachment'], { type: 'image/png' }));
    const addAttachment = vi.fn().mockResolvedValue({ id: 'attachment-2', name: 'new.png', mimeType: 'image/png', byteLength: 3 });
    await render(panel, [existing], { listAnnotations: vi.fn().mockResolvedValue([existing]), readBlob, addAttachment });
    expect(panel.querySelector('[data-annotation-attachment-input]')?.getAttribute('accept')).toContain('image/png');
    expect(panel.querySelector('[data-annotation-attachment] figcaption')?.textContent).toBe('<img src=x>');
    expect(panel.querySelector('[data-annotation-attachment] img')).not.toBeNull();
    expect(panel.querySelector('[data-annotation-attachment] img')?.innerHTML).toBe('');
  });

  it('normalizes an attachment file name before sending it', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Attachment upload');
    const addAttachment = vi.fn().mockResolvedValue({
      id: 'attachment-2', name: 'image.png', mimeType: 'image/png', byteLength: 1,
    });
    await render(panel, [existing], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      addAttachment,
    });

    const input = panel.querySelector('[data-annotation-attachment-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], `  ${'a'.repeat(130)}.png  `, { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(addAttachment).toHaveBeenCalledTimes(1));
    const sentName = addAttachment.mock.calls[0]?.[0].name as string;
    expect(sentName).toHaveLength(120);
    expect(sentName).toMatch(/\.png$/);
    expect(sentName).not.toContain('  ');
  });

  it('attaches a JPEG named .png as image/jpeg under its own name', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Renamed JPEG');
    const addAttachment = vi.fn().mockResolvedValue({ id: 'attachment-2', name: 'photo.png', mimeType: 'image/jpeg', byteLength: 7 });
    await render(panel, [existing], { listAnnotations: vi.fn().mockResolvedValue([existing]), addAttachment });

    const input = panel.querySelector('[data-annotation-attachment-input]') as HTMLInputElement;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    Object.defineProperty(input, 'files', { value: [new File([jpeg], 'photo.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(addAttachment).toHaveBeenCalledTimes(1));
    expect(addAttachment.mock.calls[0]?.[0]).toMatchObject({
      name: 'photo.png',
      mimeType: 'image/jpeg',
      base64: btoa(String.fromCharCode(...jpeg)),
    });
  });

  it('refuses non-image bytes named .png with a status and writes nothing', async () => {
    const panel = document.createElement('div');
    const existing = annotation('Fake PNG');
    const addAttachment = vi.fn();
    await render(panel, [existing], { listAnnotations: vi.fn().mockResolvedValue([existing]), addAttachment });

    const input = panel.querySelector('[data-annotation-attachment-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['<svg onload=alert(1)>'], 'fake.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() =>
      expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('fake.png is not a PNG, JPEG or WebP image.'),
    );
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it('reports screenshot read errors and continues rendering without a preview', async () => {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Unreadable preview'),
      screenshot: { mimeType: 'image/png', width: 10, height: 10, byteLength: 7 },
    };
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
      readBlob: vi.fn().mockRejectedValue(new Error('screenshot read failed')),
    });

    expect(panel.querySelector(`[data-annotation-id="${existing.id}"]`)).not.toBeNull();
    expect(panel.querySelector('[data-annotation-screenshot]')).toBeNull();
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('screenshot read failed');
    expect(panel.querySelector('[data-annotation-new-note]')).not.toBeNull();
  });

  it('reports a rejected file through statusMessage without rejecting render', async () => {
    const panel = document.createElement('div');
    const existing = annotation('File target');
    await render(panel, [existing]);
    const input = panel.querySelector('[data-annotation-attachment-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status]')?.textContent).toContain('bad.svg is not a PNG, JPEG or WebP image.'));
    await expect(createNotePanel(panel).render(context)).resolves.toBeUndefined();
  });

  it('does not add an empty or whitespace-only note', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = '   \n  ';
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('toggles resolved status through annotation.update', async () => {
    const panel = document.createElement('div');
    const existing = { ...annotation('Resolve me'), status: 'open' as const };
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [existing], { listAnnotations: vi.fn().mockResolvedValue([existing]), sendAnnotationWrite });
    (panel.querySelector('[data-annotation-status-toggle]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.update', pageUrl, id: existing.id, changes: { status: 'resolved' },
    } satisfies AnnotationWriteMessage));
  });

  it('updates a note with the exact write message and re-reads storage', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([annotation('Before')]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;
    note.value = 'After';
    (panel.querySelector('[data-annotation-edit]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));

    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.update',
      pageUrl,
      id: 'annotation-1',
      changes: { note: 'After' },
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it('does not update an existing note to empty text', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([annotation('Before')]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    const note = panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;
    note.value = '  ';
    (panel.querySelector('[data-annotation-edit]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
  });

  it('deletes a note with the exact write message and re-reads storage', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([annotation('To delete')]);
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
    });

    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));

    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.delete',
      pageUrl,
      id: 'annotation-1',
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });
});

describe('note panel close, focus, editor and live status', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mounted(): HTMLDivElement {
    const panel = document.createElement('div');
    document.body.append(panel);
    return panel;
  }

  function ctrlEnter(target: HTMLElement, init: KeyboardEventInit = { ctrlKey: true }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('renders a labelled Close button that requests close from the host', async () => {
    const panel = mounted();
    const onClose = vi.fn();
    panel.addEventListener(NOTE_PANEL_CLOSE_EVENT, onClose);
    await render(panel);
    const close = panel.querySelector<HTMLButtonElement>('[data-annotation-close]');
    expect(close?.type).toBe('button');
    expect(close?.textContent).toBe('Close');
    expect(close?.getAttribute('aria-label')).toBe('Close annotation note');
    close?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the new-note field when opened on an element without notes', async () => {
    const panel = mounted();
    await render(panel);
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-new-note]'));
  });

  it('moves focus to the first note field when opened on an annotated element', async () => {
    const panel = mounted();
    await render(panel, [annotation('Existing')]);
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-edit-note]'));
  });

  it('saves with Ctrl+Enter and Cmd+Enter exactly like Save', async () => {
    const panel = mounted();
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [], { sendAnnotationWrite });
    const note = () => panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;

    note().value = 'With ctrl';
    expect(ctrlEnter(note()).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));
    note().value = 'With cmd';
    ctrlEnter(note(), { metaKey: true });
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(2));
    note().value = 'Plain enter';
    ctrlEnter(note(), {});
    await Promise.resolve();

    expect(sendAnnotationWrite).toHaveBeenCalledTimes(2);
    expect(sendAnnotationWrite).toHaveBeenNthCalledWith(1, {
      type: 'annotation.add', pageUrl, input: { note: 'With ctrl', selector: context.selector, elementContext: context },
    } satisfies AnnotationWriteMessage);
    expect(sendAnnotationWrite).toHaveBeenNthCalledWith(2, {
      type: 'annotation.add', pageUrl, input: { note: 'With cmd', selector: context.selector, elementContext: context },
    } satisfies AnnotationWriteMessage);
  });

  it('keeps focus on the new-note field after a keyboard save re-renders the panel', async () => {
    const panel = mounted();
    const listAnnotations = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([annotation('Saved')]);
    await render(panel, [], { listAnnotations });
    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = 'Saved';
    ctrlEnter(note);
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-edit-note]')).not.toBeNull());
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-new-note]'));
    expect(document.activeElement).not.toBe(note);
  });

  it('asks inline before deleting, and only Delete sends annotation.delete', async () => {
    const panel = mounted();
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    await render(panel, [annotation('To delete')], { sendAnnotationWrite });
    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    const prompt = panel.querySelector('[data-annotation-delete-prompt]');
    expect([prompt?.getAttribute('role'), prompt?.getAttribute('aria-label')]).toEqual(['group', 'Confirm delete annotation']);
    expect(prompt?.querySelector('p')?.textContent).toBe('Delete this annotation? This cannot be undone.');
    expect(document.activeElement).toBe(prompt?.querySelector('[data-annotation-delete-cancel]'));

    prompt?.querySelector<HTMLButtonElement>('[data-annotation-delete-confirm]')!.click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));
    expect(sendAnnotationWrite).toHaveBeenCalledWith({ type: 'annotation.delete', pageUrl, id: 'annotation-1' });
  });

  it('moves focus to the heading when the focused control is gone after a re-render', async () => {
    const panel = mounted();
    const listAnnotations = vi.fn().mockResolvedValueOnce([annotation('Delete me')]).mockResolvedValue([]);
    await render(panel, [], { listAnnotations });
    const remove = panel.querySelector('[data-annotation-delete]') as HTMLButtonElement;
    remove.focus();
    remove.click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-delete]')).toBeNull());
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('refuses an empty save with a status in the persistent live region', async () => {
    const panel = mounted();
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const { notePanel } = await render(panel, [], { sendAnnotationWrite });
    const live = notePanel.live;
    document.body.append(live);
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('');

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = '  \n ';
    ctrlEnter(note);
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect(live.textContent).toBe('Write a note before saving.');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Write a note before saving.');
  });

  it('announces a write error through the same live node across re-renders and clears it on success', async () => {
    const panel = mounted();
    const sendAnnotationWrite = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(undefined);
    const { notePanel } = await render(panel, [], { sendAnnotationWrite });
    const live = notePanel.live;
    document.body.append(live);
    const save = (value: string) => {
      (panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement).value = value;
      (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    };

    save('Fails');
    await vi.waitFor(() => expect(live.textContent).toBe('write failed'));
    expect(notePanel.live).toBe(live);
    expect(live.isConnected).toBe(true);
    save('Works');
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(live.textContent).toBe('Note saved.'));
  });

  it('clear() empties the panel and the live region and drops a pending render', async () => {
    const panel = mounted();
    let resolveList: (value: Annotation[]) => void = () => undefined;
    const listAnnotations = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise<Annotation[]>((resolve) => { resolveList = resolve; }));
    const { notePanel } = await render(panel, [], { listAnnotations });
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    expect(notePanel.live.textContent).toBe('Write a note before saving.');

    const pending = notePanel.render(context);
    notePanel.clear();
    expect(panel.childElementCount).toBe(0);
    expect(notePanel.live.textContent).toBe('');
    resolveList([annotation('Late')]);
    await pending;
    expect(panel.childElementCount).toBe(0);
  });
});

describe('note panel screenshot outcome, fresh status, labels, announcements and names', () => {
  const chromeRefusal = "Either the '<all_urls>' or 'activeTab' permission is required.";

  async function captureWith(error: unknown) {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Shot')], {
      captureScreenshot: vi.fn().mockRejectedValue(error),
    });
    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(panel.querySelector('[data-annotation-status]')).not.toBeNull());
    return { panel, notePanel, status: panel.querySelector('[data-annotation-status]')?.textContent ?? '' };
  }

  it('tells the user to grant the tab with the toolbar icon or the bound shortcut, then retry', async () => {
    const { status, notePanel } = await captureWith(
      new ScreenshotCaptureError({ kind: 'needs-grant', shortcut: 'Alt+Shift+A' }),
    );
    expect(status).toContain('toolbar icon');
    expect(status).toContain('Alt+Shift+A');
    expect(status).toMatch(/again/);
    expect(status).not.toContain(chromeRefusal);
    expect(notePanel.live.textContent).toBe(status);
  });

  it('leaves the shortcut out of the grant message when none is bound', async () => {
    const { status } = await captureWith(new ScreenshotCaptureError({ kind: 'needs-grant' }));
    expect(status).toContain('toolbar icon');
    expect(status).not.toMatch(/press/i);
  });

  it('shows any other capture failure as Screenshot failed with its reason', async () => {
    const { status } = await captureWith(new ScreenshotCaptureError({ kind: 'failed', reason: 'decode failed' }));
    expect(status).toBe('Screenshot failed: decode failed');
  });

  async function failThen(persistence: Partial<NotePanelPersistence>) {
    const panel = document.createElement('div');
    const existing = {
      ...annotation('Fresh'),
      attachments: [{ id: 'attachment-1', name: 'a.png', mimeType: 'image/png', byteLength: 1 }],
    };
    const { notePanel } = await render(panel, [existing], {
      captureScreenshot: vi.fn()
        .mockRejectedValueOnce(new ScreenshotCaptureError({ kind: 'failed', reason: 'decode failed' }))
        .mockResolvedValue(undefined),
      ...persistence,
    });
    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Screenshot failed: decode failed'),
    );
    return { panel, notePanel };
  }

  const cleared = async (panel: HTMLElement) =>
    vi.waitFor(() => expect(panel.textContent).not.toContain('Screenshot failed'));

  it('clears a previous error after a successful screenshot', async () => {
    const { panel } = await failThen({});
    (panel.querySelector('[data-annotation-capture-screenshot]') as HTMLButtonElement).click();
    await cleared(panel);
  });

  it('clears a previous error after a successful attachment add', async () => {
    const addAttachment = vi.fn().mockResolvedValue({});
    const { panel } = await failThen({ addAttachment });
    const input = panel.querySelector('[data-annotation-attachment-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'b.png', { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(addAttachment).toHaveBeenCalledTimes(1));
    await cleared(panel);
  });

  it('clears a previous error after a successful attachment remove', async () => {
    const deleteAttachment = vi.fn().mockResolvedValue(true);
    const { panel } = await failThen({ deleteAttachment });
    (panel.querySelector('[data-annotation-attachment-delete]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(deleteAttachment).toHaveBeenCalledTimes(1));
    await cleared(panel);
  });

  it('clears a previous error after a successful repro save and a successful note save', async () => {
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const { panel } = await failThen({ sendAnnotationWrite });
    (panel.querySelector('[data-annotation-repro-steps]') as HTMLTextAreaElement).value = 'Open page';
    (panel.querySelector('[data-annotation-repro-save]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));
    await cleared(panel);

    const second = await failThen({ sendAnnotationWrite });
    (second.panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement).value = 'More';
    (second.panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await cleared(second.panel);
    expect(second.notePanel.live.textContent).toBe('Note saved.');
  });

  it('binds a visible label to the CSS and repro fields', async () => {
    const panel = document.createElement('div');
    await render(panel, [annotation('Labels')]);
    for (const [selector, text] of [
      ['[data-annotation-css-decls]', 'CSS declarations'],
      ['[data-annotation-repro-steps]', 'Reproduction steps'],
      ['[data-annotation-repro-expected]', 'Expected result'],
      ['[data-annotation-repro-actual]', 'Actual result'],
    ] as const) {
      const field = panel.querySelector<HTMLTextAreaElement>(selector)!;
      const label = field.closest('label');
      expect(label, selector).not.toBeNull();
      expect(label?.textContent).toContain(text);
      expect(field.labels?.[0]).toBe(label);
    }
  });

  it('names fields by the 1-based page position, never by the annotation id', async () => {
    const panel = document.createElement('div');
    const first = { ...annotation('Elsewhere'), id: '3f2a9c1e-0000-4000-8000-000000000001', selector: '.other' };
    const second = { ...annotation('Here'), id: '3f2a9c1e-0000-4000-8000-000000000002' };
    await render(panel, [first, second]);
    const names = Array.from(panel.querySelectorAll('textarea[aria-label]'), (field) => field.getAttribute('aria-label') ?? '');
    const itemNames = names.filter((name) => name !== 'New note');
    expect(itemNames).toHaveLength(5);
    for (const name of itemNames) {
      expect(name).not.toContain(second.id);
      expect(name).toMatch(/annotation 2$/);
    }
  });
});

describe('note panel text caps', () => {
  it('caps the note and repro fields at the shared text cap', async () => {
    const panel = document.createElement('div');
    await render(panel, [annotation('Existing note')]);
    for (const selector of [
      '[data-annotation-new-note]',
      '[data-annotation-edit-note]',
      '[data-annotation-repro-steps]',
      '[data-annotation-repro-expected]',
      '[data-annotation-repro-actual]',
    ]) {
      expect(panel.querySelector<HTMLTextAreaElement>(selector)?.maxLength, selector).toBe(MAX_TEXT_LENGTH);
    }
  });

  it('refuses a save the write guard would refuse, says what was too long, and keeps the typed note', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const long = 'x'.repeat(MAX_TEXT_LENGTH + 1);
    const notePanel = createNotePanel(panel, {
      listAnnotations: vi.fn().mockResolvedValue([]),
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      readBlob: vi.fn(),
      addAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(),
      revertCssEdits: vi.fn(),
      revertAllCssEdits: vi.fn(),
    });
    await notePanel.render({ ...context, selector: long });

    const note = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    note.value = 'Keep me';
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe(
        `The selector is longer than ${MAX_TEXT_LENGTH} characters.`,
      ),
    );
    expect(notePanel.live.textContent).toBe(`The selector is longer than ${MAX_TEXT_LENGTH} characters.`);
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect((panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement).value).toBe('Keep me');
  });

  it('refuses a CSS save whose value is over the cap without writing it', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(undefined);
    const long = 'x'.repeat(MAX_TEXT_LENGTH + 1);
    await render(panel, [annotation('Existing note')], {
      sendAnnotationWrite,
      applyCssEdits: vi.fn().mockReturnValue([{ property: 'color', value: long, original: 'blue' }]),
    });

    const css = panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement;
    css.value = `color: ${long}`;
    (panel.querySelector('[data-annotation-css-save]') as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(panel.querySelector('[data-annotation-status]')?.textContent).toContain('The CSS edits are not valid'),
    );
    expect(sendAnnotationWrite).not.toHaveBeenCalled();
    expect((panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value).toBe(`color: ${long}`);
  });
});

describe('note panel across tabs', () => {
  const DELETED = 'This annotation was deleted in another tab.';
  const CHANGED = 'This annotation changed in another tab.';

  function status(panel: HTMLElement) {
    return panel.querySelector('[data-annotation-status]')?.textContent;
  }

  it('reports an update to a deleted annotation instead of resolving silently', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Stale')], {
      sendAnnotationWrite: vi.fn().mockResolvedValue(null),
    });

    (panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement).value = 'Edited';
    (panel.querySelector('[data-annotation-edit]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(status(panel)).toBe(DELETED));
    expect(notePanel.live.textContent).toBe(DELETED);
  });

  it('reports a delete of a deleted annotation instead of resolving silently', async () => {
    const panel = document.createElement('div');
    await render(panel, [annotation('Stale')], { sendAnnotationWrite: vi.fn().mockResolvedValue(false) });

    (panel.querySelector('[data-annotation-delete]') as HTMLButtonElement).click();
    (panel.querySelector('[data-annotation-delete-confirm]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(status(panel)).toBe(DELETED));
  });

  it('re-renders when another tab changed its annotations and nothing is being typed', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([annotation('From A')]);
    const { notePanel } = await render(panel, [], { listAnnotations });

    listAnnotations.mockResolvedValue([{ ...annotation('A edit'), updatedAt: '2024-01-02T00:00:00.000Z' }]);
    await notePanel.syncWithStorage();

    expect((panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement).value).toBe('A edit');
    expect(status(panel)).toBeUndefined();
  });

  it('keeps a note being typed and says the annotation changed in another tab', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([annotation('From A')]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    const editor = panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;
    editor.value = 'B typing';

    listAnnotations.mockResolvedValue([{ ...annotation('A edit'), updatedAt: '2024-01-02T00:00:00.000Z' }]);
    await notePanel.syncWithStorage();

    expect(panel.querySelector('[data-annotation-edit-note]')).toBe(editor);
    expect(editor.value).toBe('B typing');
    expect(status(panel)).toBe(CHANGED);
    expect(notePanel.live.textContent).toBe(CHANGED);
  });

  it('keeps a half-typed new note when another tab adds an annotation', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    const draft = panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
    draft.value = 'Draft';

    listAnnotations.mockResolvedValue([annotation('From A')]);
    await notePanel.syncWithStorage();

    expect(panel.querySelector('[data-annotation-new-note]')).toBe(draft);
    expect(draft.value).toBe('Draft');
    expect(status(panel)).toBe(CHANGED);
  });

  it('renumbers the open panel when another tab adds an annotation earlier on the page', async () => {
    const panel = document.createElement('div');
    const here = annotation('Here');
    const listAnnotations = vi.fn().mockResolvedValue([here]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    expect(panel.querySelector('[data-annotation-edit-note]')?.getAttribute('aria-label')).toBe('Edit note, annotation 1');

    listAnnotations.mockResolvedValue([{ ...annotation('Elsewhere'), id: 'annotation-0', selector: '.other' }, here]);
    await notePanel.syncWithStorage();

    expect(panel.querySelector('[data-annotation-edit-note]')?.getAttribute('aria-label')).toBe('Edit note, annotation 2');
    expect(status(panel)).toBeUndefined();
  });

  it('keeps typed text and says the page changed when another tab deletes an earlier annotation', async () => {
    const panel = document.createElement('div');
    const here = annotation('Here');
    const listAnnotations = vi.fn().mockResolvedValue([{ ...annotation('Elsewhere'), id: 'annotation-0', selector: '.other' }, here]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    const editor = panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;
    editor.value = 'B typing';

    listAnnotations.mockResolvedValue([here]);
    await notePanel.syncWithStorage();

    expect(panel.querySelector('[data-annotation-edit-note]')).toBe(editor);
    expect(editor.value).toBe('B typing');
    expect(status(panel)).toBe(CHANGED);
  });

  it('leaves the panel alone when storage matches what it shows', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Same')]);
    const item = panel.querySelector('[data-annotation-id]');

    await notePanel.syncWithStorage();

    expect(panel.querySelector('[data-annotation-id]')).toBe(item);
    expect(status(panel)).toBeUndefined();
  });

  it('does nothing when the panel is closed', async () => {
    const panel = document.createElement('div');
    const listAnnotations = vi.fn().mockResolvedValue([annotation('A')]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    notePanel.clear();
    listAnnotations.mockClear();

    await notePanel.syncWithStorage();

    expect(listAnnotations).not.toHaveBeenCalled();
    expect(panel.childElementCount).toBe(0);
  });
});

describe('note panel drafts', () => {
  const type = (field: HTMLTextAreaElement, value: string) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const newNote = (panel: HTMLElement) => panel.querySelector('[data-annotation-new-note]') as HTMLTextAreaElement;
  const editNote = (panel: HTMLElement) => panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;

  it('keeps new-note text across close and reopen of the same element and says the draft was restored', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel);
    type(newNote(panel), 'Half written');
    notePanel.clear();
    await notePanel.render(context);
    expect(newNote(panel).value).toBe('Half written');
    expect(newNote(panel).defaultValue).toBe('');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Draft restored.');
    expect(notePanel.live.textContent).toBe('Draft restored.');
  });

  it('keeps new-note text when a write on another note re-renders the panel', async () => {
    const panel = document.createElement('div');
    const { listAnnotations } = await render(panel, [annotation('Existing')]);
    type(newNote(panel), 'Still typing');
    (panel.querySelector('[data-annotation-status-toggle]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
    expect(newNote(panel).value).toBe('Still typing');
  });

  it('keeps edit-field text across close and reopen', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Existing')]);
    type(editNote(panel), 'Existing, edited');
    notePanel.clear();
    await notePanel.render(context);
    expect(editNote(panel).value).toBe('Existing, edited');
    expect(editNote(panel).defaultValue).toBe('Existing');
    expect(panel.querySelector('[data-annotation-status]')?.textContent).toBe('Draft restored.');
  });

  it('drops the new-note draft once the note is saved', async () => {
    const panel = document.createElement('div');
    const { notePanel, listAnnotations } = await render(panel);
    type(newNote(panel), 'Saved note');
    notePanel.clear();
    await notePanel.render(context);
    expect(newNote(panel).value).toBe('Saved note');
    (panel.querySelector('[data-annotation-save]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
    notePanel.clear();
    await notePanel.render(context);
    expect(newNote(panel).value).toBe('');
    expect(panel.querySelector('[data-annotation-status]')).toBeNull();
  });

  it('keys a new-note draft by element: another element opens with an empty field', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel);
    type(newNote(panel), 'For #target');
    notePanel.clear();
    await notePanel.render({ ...context, selector: '#other' });
    expect(newNote(panel).value).toBe('');
    notePanel.clear();
    await notePanel.render(context);
    expect(newNote(panel).value).toBe('For #target');
  });
});

describe('note panel layout', () => {
  const type = (field: HTMLTextAreaElement, value: string) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const keyEnter = (target: HTMLElement, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
  const editNote = (panel: HTMLElement) => panel.querySelector('[data-annotation-edit-note]') as HTMLTextAreaElement;
  const unsaved = (panel: HTMLElement) => panel.querySelector<HTMLElement>('[data-annotation-unsaved]');
  const cssGroup = (panel: HTMLElement) => panel.querySelector('[data-annotation-css-group]') as HTMLDetailsElement;
  const reproGroup = (panel: HTMLElement) => panel.querySelector('[data-annotation-repro-group]') as HTMLDetailsElement;

  it('names the element under the Notes heading with the selector as its title', async () => {
    const panel = document.createElement('div');
    await render(panel);
    const hint = panel.querySelector<HTMLElement>('[data-annotation-hint]');
    expect(panel.children[0]?.textContent).toBe('Notes');
    expect(panel.children[1]).toBe(hint);
    expect(hint?.textContent).toBe('BUTTON#target.primary "Target"');
    expect(hint?.title).toBe('#target');
  });

  it('falls back to the selector when the element has no name', async () => {
    const panel = document.createElement('div');
    const notePanel = createNotePanel(panel, {
      listAnnotations: vi.fn().mockResolvedValue([]),
      sendAnnotationWrite: vi.fn(),
      captureScreenshot: vi.fn(),
      readBlob: vi.fn(),
      addAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(),
      revertCssEdits: vi.fn(),
      revertAllCssEdits: vi.fn(),
    });
    await notePanel.render({ ...context, tagName: '', id: '', classList: [], text: ' ' });
    expect(panel.querySelector('[data-annotation-hint]')?.textContent).toBe('#target');
  });

  it('puts the status right after the heading, element name and Close', async () => {
    const panel = document.createElement('div');
    await render(panel, [], { listAnnotations: vi.fn().mockRejectedValue(new Error('list failed')) });
    expect(Array.from(panel.children, (child) => child.tagName)).toEqual(['H2', 'P', 'BUTTON', 'P', 'FORM']);
    expect(panel.children[3]?.hasAttribute('data-annotation-status')).toBe(true);
  });

  it('labels the edit save button Save note', async () => {
    const panel = document.createElement('div');
    await render(panel, [annotation('Existing')]);
    expect(panel.querySelector('[data-annotation-edit]')?.textContent).toBe('Save note');
  });

  it('saves an edit with Ctrl+Enter and Cmd+Enter exactly like Save note, and never a blank one', async () => {
    const panel = document.createElement('div');
    const sendAnnotationWrite = vi.fn().mockResolvedValue(annotation('x'));
    const { listAnnotations } = await render(panel, [annotation('Existing')], { sendAnnotationWrite });
    const expected = (note: string) => ({
      type: 'annotation.update',
      pageUrl,
      id: 'annotation-1',
      changes: { note },
    } satisfies AnnotationWriteMessage);
    // Each save re-reads storage and re-renders; the form is appended last, once the re-render is done.
    const saveAndSettle = async (value: string, save: () => unknown, writes: number) => {
      const before = panel.querySelector('form');
      editNote(panel).value = value;
      save();
      await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenNthCalledWith(writes, expected(value.trim())));
      await vi.waitFor(() => {
        expect(listAnnotations).toHaveBeenCalledTimes(writes + 1);
        expect(panel.querySelector('form')).not.toBe(before);
        expect(panel.querySelector('form')).not.toBeNull();
      });
    };

    await saveAndSettle(' With ctrl ', () => expect(keyEnter(editNote(panel), { ctrlKey: true })).toBe(false), 1);
    await saveAndSettle('With cmd', () => keyEnter(editNote(panel), { metaKey: true }), 2);
    await saveAndSettle('By button', () => (panel.querySelector('[data-annotation-edit]') as HTMLButtonElement).click(), 3);
    editNote(panel).value = '   ';
    keyEnter(editNote(panel), { ctrlKey: true });
    keyEnter(editNote(panel), { metaKey: true });
    editNote(panel).value = 'Plain enter';
    keyEnter(editNote(panel), {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendAnnotationWrite).toHaveBeenCalledTimes(3);
  });

  it('shows Unsaved changes while the edit differs from the stored note, without announcing it', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Existing')]);
    expect(unsaved(panel)?.hidden).toBe(true);
    type(editNote(panel), 'Existing, edited');
    expect(unsaved(panel)?.hidden).toBe(false);
    expect(unsaved(panel)?.textContent).toBe('Unsaved changes');
    expect(notePanel.live.textContent).toBe('');
    type(editNote(panel), 'Existing');
    expect(unsaved(panel)?.hidden).toBe(true);
  });

  it('shows Unsaved changes for a restored edit draft', async () => {
    const panel = document.createElement('div');
    const { notePanel } = await render(panel, [annotation('Existing')]);
    type(editNote(panel), 'Draft text');
    notePanel.clear();
    await notePanel.render(context);
    expect(unsaved(panel)?.hidden).toBe(false);
  });

  it('opens a group only when the annotation has content for it', async () => {
    const empty = document.createElement('div');
    await render(empty, [{ ...annotation('Plain'), cssEdits: [] }]);
    expect(cssGroup(empty).open).toBe(false);
    expect(reproGroup(empty).open).toBe(false);
    expect(cssGroup(empty).querySelector('summary')?.textContent).toBe('CSS tweaks');
    expect(reproGroup(empty).querySelector('summary')?.textContent).toBe('Reproduction steps');

    const full = document.createElement('div');
    await render(full, [{
      ...annotation('Full'),
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
      repro: { steps: ['Click'], expected: 'Opens', actual: 'Nothing' },
    }]);
    expect(cssGroup(full).open).toBe(true);
    expect(reproGroup(full).open).toBe(true);
  });

  it('keeps a toggled group open or closed across a re-render', async () => {
    const panel = document.createElement('div');
    const withRepro = { ...annotation('Existing'), repro: { steps: ['Click'], expected: 'a', actual: 'b' } };
    const { notePanel } = await render(panel, [withRepro]);
    cssGroup(panel).open = true;
    reproGroup(panel).open = false;
    notePanel.clear();
    await notePanel.render(context);
    expect(cssGroup(panel).open).toBe(true);
    expect(reproGroup(panel).open).toBe(false);
  });

  it('closes an emptied group after the late initial toggle event of its content-opened render', async () => {
    const panel = document.createElement('div');
    const withCss = { ...annotation('Styled'), cssEdits: [{ property: 'color', value: 'red', original: 'blue' }] };
    const listAnnotations = vi.fn().mockResolvedValue([withCss]);
    const { notePanel } = await render(panel, [], { listAnnotations });
    expect(cssGroup(panel).open).toBe(true);
    cssGroup(panel).dispatchEvent(new Event('toggle'));
    listAnnotations.mockResolvedValue([{ ...withCss, cssEdits: [] }]);
    notePanel.clear();
    await notePanel.render(context);
    expect(cssGroup(panel).open).toBe(false);
  });

  it('orders an item as note section, Unsaved changes, Attach image, CSS group, repro group, then previews', async () => {
    const panel = document.createElement('div');
    await render(panel, [{
      ...annotation('Full'),
      cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
      repro: { steps: ['Click'], expected: 'Opens', actual: 'Nothing' },
      screenshot: { mimeType: 'image/png', width: 1, height: 1, byteLength: 1 },
      attachments: [{ id: 'att-1', name: 'a.png', mimeType: 'image/png', byteLength: 1 }],
    }]);
    const item = panel.querySelector('[data-annotation-id="annotation-1"]') as HTMLElement;
    const nameOf = (child: Element) =>
      child.getAttributeNames().find((name) => name.startsWith('data-annotation-')) ?? child.tagName;
    expect(Array.from(item.children, nameOf)).toEqual([
      'data-annotation-edit-note',
      'data-annotation-edit',
      'data-annotation-status-toggle',
      'data-annotation-capture-screenshot',
      'data-annotation-delete',
      'data-annotation-unsaved',
      'LABEL',
      'data-annotation-css-group',
      'data-annotation-repro-group',
      'data-annotation-screenshot',
      'data-annotation-attachment',
    ]);
    expect(Array.from(cssGroup(panel).children, nameOf)).toEqual([
      'SUMMARY',
      'LABEL',
      'data-annotation-css-save',
      'data-annotation-css-clear',
      'data-annotation-css',
    ]);
    expect(Array.from(reproGroup(panel).children, nameOf)).toEqual([
      'SUMMARY',
      'LABEL',
      'LABEL',
      'LABEL',
      'data-annotation-repro-save',
      'data-annotation-repro',
    ]);
  });
});
