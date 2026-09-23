import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
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
});
