// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocateHighlight } from './locate-highlight';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('locate highlight', () => {
  it('scrolls to the element, keeps one fixed highlight over it, and removes it after 1500ms', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const a = document.createElement('p');
    const b = document.createElement('p');
    document.body.append(root, a, b);
    a.scrollIntoView = vi.fn();
    b.scrollIntoView = vi.fn();
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 }));
    const highlight = createLocateHighlight();

    highlight.show(root, a);
    highlight.show(root, b);
    expect(a.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    expect(b.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    const shown = root.querySelectorAll<HTMLElement>('[data-annotation-scan-highlight]');
    expect(shown).toHaveLength(1);
    expect([shown[0]?.style.position, shown[0]?.style.top, shown[0]?.style.left]).toEqual(['fixed', '2px', '1px']);

    vi.advanceTimersByTime(1499);
    expect(root.querySelector('[data-annotation-scan-highlight]')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(root.querySelector('[data-annotation-scan-highlight]')).toBeNull();
  });

  it('remove() drops the highlight and its timer', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const el = document.createElement('p');
    document.body.append(root, el);
    el.scrollIntoView = vi.fn();
    const highlight = createLocateHighlight();
    highlight.show(root, el);
    highlight.remove();
    expect(root.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('scrolls instantly under reduced motion and leaves behavior unset otherwise', () => {
    const root = document.createElement('div');
    const el = document.createElement('p');
    document.body.append(root, el);
    el.scrollIntoView = vi.fn();
    const highlight = createLocateHighlight();

    highlight.show(root, el);
    expect(el.scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest' });
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList,
    );
    highlight.show(root, el);
    expect(el.scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' });
    highlight.remove();
  });

  it('follows the element on scroll and resize, and remove() detaches those listeners', () => {
    const root = document.createElement('div');
    const el = document.createElement('p');
    document.body.append(root, el);
    el.scrollIntoView = vi.fn();
    const rect = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 }));
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const highlight = createLocateHighlight();

    highlight.show(root, el);
    const onScroll = addDocument.mock.calls.find(([type]) => type === 'scroll');
    const onResize = addWindow.mock.calls.find(([type]) => type === 'resize');
    expect(onScroll?.[2]).toEqual({ capture: true, passive: true });
    rect.mockReturnValue(DOMRect.fromRect({ x: 5, y: 6, width: 3, height: 4 }));
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    const box = root.querySelector<HTMLElement>('[data-annotation-scan-highlight]');
    expect([box?.style.top, box?.style.left]).toEqual(['6px', '5px']);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    document.dispatchEvent(new Event('scroll'));

    highlight.remove();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(removeDocument).toHaveBeenCalledWith('scroll', onScroll?.[1], { capture: true });
    expect(removeWindow).toHaveBeenCalledWith('resize', onResize?.[1]);
  });
});
