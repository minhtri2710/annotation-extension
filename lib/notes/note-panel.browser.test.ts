import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { buildOverlayShell } from '../ui/shell';
import { createNotePanel } from './note-panel';

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
    expect(notePanel.live.textContent).toBe('');
  });
});
