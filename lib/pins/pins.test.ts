// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createPinsController, resolveElement } from './pins';

const pageUrl = 'https://example.com/article';
const context: ElementContext = {
  selector: '#target',
  tagName: 'BUTTON',
  id: 'target',
  classList: [],
  text: 'Target',
  boundingBox: { x: 1, y: 2, width: 100, height: 40 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

function annotation(id: string, selector = context.selector): Annotation {
  return {
    id,
    pageUrl,
    note: `Note ${id}`,
    selector,
    elementContext: context,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function setup() {
  document.body.innerHTML = '<button id="target">Target</button><div id="toolbar"></div><div id="overlay"></div>';
  const toolbar = document.querySelector('#toolbar') as HTMLDivElement;
  const overlay = document.querySelector('#overlay') as HTMLDivElement;
  return { toolbar, overlay, target: document.querySelector('#target') as HTMLElement };
}

describe('resolveElement', () => {
  it('resolves a valid selector', () => {
    setup();

    expect(resolveElement(document, '#target')).toBe(document.querySelector('#target'));
  });

  it('returns null for a missing element', () => {
    setup();

    expect(resolveElement(document, '#missing')).toBeNull();
  });

  it('returns null for an invalid selector without throwing', () => {
    setup();

    expect(() => resolveElement(document, '[')).not.toThrow();
    expect(resolveElement(document, '[')).toBeNull();
  });
});

describe('pins controller', () => {
  it('renders one marker for each annotation with a resolvable selector', () => {
    const { toolbar, overlay } = setup();
    const annotations = [annotation('annotation-1'), annotation('annotation-2', '#missing')];
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations(annotations);

    expect(overlay.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    expect(overlay.querySelector('[data-annotation-id="annotation-1"]')).not.toBeNull();
    expect(overlay.querySelector('[data-annotation-id="annotation-2"]')).toBeNull();
    controller.destroy();
  });

  it('sets the badge count to the page annotation count', () => {
    const { toolbar, overlay } = setup();
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([annotation('annotation-1'), annotation('annotation-2', '#missing')]);

    const badge = toolbar.querySelector('[data-annotation-badge]');
    expect(badge?.textContent).toBe('2');
    controller.destroy();
  });

  it('labels markers with their 1-based annotation ordinal', () => {
    const { toolbar, overlay } = setup();
    const secondTarget = document.createElement('button');
    secondTarget.id = 'second-target';
    document.body.append(secondTarget);
    const controller = createPinsController({ document, container: overlay, toolbar });

    controller.setAnnotations([
      annotation('annotation-1'),
      annotation('annotation-2', '#missing'),
      annotation('annotation-3', '#second-target'),
    ]);

    const markers = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'));
    expect(markers.map((marker) => marker.textContent)).toEqual(['1', '3']);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'Annotation 1',
      'Annotation 3',
    ]);
    controller.destroy();
  });

  it('shows and tears down a truncated note tooltip on hover and focus', () => {
    const { toolbar, overlay } = setup();
    const matching = annotation('annotation-1');
    matching.note = 'P'.repeat(121);
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([matching]);
    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;

    marker.dispatchEvent(new Event('mouseenter'));
    const hoverTooltip = overlay.querySelector('[data-annotation-tooltip]');
    expect(hoverTooltip?.textContent).toBe(`${'P'.repeat(120)}…`);
    expect(hoverTooltip?.parentElement).toBe(overlay);

    marker.dispatchEvent(new Event('mouseleave'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();

    marker.dispatchEvent(new Event('focus'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
    marker.dispatchEvent(new Event('blur'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();

    marker.dispatchEvent(new Event('mouseenter'));
    expect(overlay.querySelector('[data-annotation-tooltip]')).not.toBeNull();
    controller.destroy();
    expect(overlay.querySelector('[data-annotation-tooltip]')).toBeNull();
  });

  it('re-anchors tracked markers against their current element rect', () => {
    const { toolbar, overlay, target } = setup();
    const getBoundingClientRect = vi
      .spyOn(target, 'getBoundingClientRect')
      .mockReturnValue({
        x: 12,
        y: 34,
        left: 12,
        top: 34,
        right: 68,
        bottom: 112,
        width: 56,
        height: 78,
        toJSON: () => ({}),
      });
    const controller = createPinsController({ document, container: overlay, toolbar });
    controller.setAnnotations([annotation('annotation-1')]);
    getBoundingClientRect.mockClear();

    controller.reanchor();

    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLElement;
    expect(getBoundingClientRect).toHaveBeenCalled();
    expect(marker.style.left).toBe('12px');
    expect(marker.style.top).toBe('34px');
    expect(marker.style.width).toBe('18px');
    expect(marker.style.height).toBe('18px');
    controller.destroy();
  });

  it('activates the matching annotation exactly once when its marker is clicked', () => {
    const { toolbar, overlay } = setup();
    const matching = annotation('annotation-1');
    const onActivate = vi.fn();
    const controller = createPinsController({ document, container: overlay, toolbar, onActivate });
    controller.setAnnotations([matching]);

    const marker = overlay.querySelector('[data-annotation-id="annotation-1"]') as HTMLButtonElement;
    marker.click();

    expect(marker.classList.contains('locate-pulse')).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(matching);
    controller.destroy();
  });
});
