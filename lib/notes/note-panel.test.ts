// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import type { ElementContext } from '../capture/context';
import { createNotePanel } from './note-panel';
import type { NotePanelPersistence } from './persistence';

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
  const readScreenshot = persistence?.readScreenshot ?? vi.fn().mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
  const applyCssEdits = persistence?.applyCssEdits ?? vi.fn();
  const revertCssEdits = persistence?.revertCssEdits ?? vi.fn();
  const revertAllCssEdits = persistence?.revertAllCssEdits ?? vi.fn();
  const notePanel = createNotePanel(panel, {
    listAnnotations,
    sendAnnotationWrite,
    captureScreenshot,
    readScreenshot,
    applyCssEdits,
    revertCssEdits,
    revertAllCssEdits,
  });
  await notePanel.render(context);
  return {
    listAnnotations,
    sendAnnotationWrite,
    captureScreenshot,
    readScreenshot,
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
    const applyCssEdits = vi.fn();
    const { applyCssEdits: apply } = await render(panel, [], {
      listAnnotations,
      sendAnnotationWrite,
      captureScreenshot: vi.fn(),
      applyCssEdits,
    });

    (panel.querySelector('[data-annotation-css-decls]') as HTMLTextAreaElement).value =
      '  color: red  \n\ninvalid line\n margin : 1rem: extra \n : missing-property \n padding:   ';
    (panel.querySelector('[data-annotation-css-save]') as HTMLButtonElement).click();

    const cssEdits = [
      { property: 'color', value: 'red' },
      { property: 'margin', value: '1rem: extra' },
    ];
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith(existing, cssEdits);
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
      cssEdits: [{ property: 'color', value: 'red' }, { property: 'display', value: 'block' }],
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
      cssEdits: [{ property: 'color', value: 'red' }, { property: 'display', value: 'block' }],
    };
    await render(panel, [], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    });

    const readout = panel.querySelector('[data-annotation-css]');
    expect(readout).not.toBeNull();
    expect(readout?.textContent).toContain('color: red');
    expect(readout?.textContent).toContain('display: block');
    expect(panel.querySelector('[data-annotation-css-clear]')).not.toBeNull();
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
      cssEdits: [{ property: 'color', value: 'red' }],
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
    const { notePanel, readScreenshot } = await render(panel, [existing], {
      listAnnotations: vi.fn().mockResolvedValue([existing]),
      sendAnnotationWrite: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
      readScreenshot: vi.fn().mockResolvedValue(new Blob(['existing'], { type: 'image/png' })),
    });

    const preview = panel.querySelector('[data-annotation-screenshot]') as HTMLImageElement;
    expect(preview).not.toBeNull();
    expect(preview.src).toContain('blob:preview');
    expect(readScreenshot).toHaveBeenCalledWith(existing.id);
    await notePanel.render(context);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    vi.unstubAllGlobals();
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
    await vi.waitFor(() => expect(sendAnnotationWrite).toHaveBeenCalledTimes(1));

    expect(sendAnnotationWrite).toHaveBeenCalledWith({
      type: 'annotation.delete',
      pageUrl,
      id: 'annotation-1',
    } satisfies AnnotationWriteMessage);
    await vi.waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });
});
