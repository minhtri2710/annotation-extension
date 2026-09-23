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
});
