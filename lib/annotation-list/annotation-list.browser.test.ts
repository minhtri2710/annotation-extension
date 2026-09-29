import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
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
    expect(shell.panel.lastElementChild).toBe(footer);
    expect(footer.getBoundingClientRect().top).toBeGreaterThan(rows.getBoundingClientRect().bottom);
    const footerStyle = getComputedStyle(footer);
    expect(footerStyle.borderTopWidth).toBe('1px');
    expect(parseColor(footerStyle.borderTopColor)).toEqual(parseColor(getComputedStyle(shell.root).getPropertyValue('--annotation-color-border')));
    const clearStyle = getComputedStyle(clear);
    expect(clearStyle.borderTopColor).toBe(clearStyle.borderBottomColor);
    expect(clear.getBoundingClientRect().height).toBe(shell.panel.querySelector<HTMLButtonElement>('[data-annotation-row-actions] [data-annotation-locate]')!.getBoundingClientRect().height);
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
