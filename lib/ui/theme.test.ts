// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { watchColorScheme } from './theme';

// A stub prefers-color-scheme query: an EventTarget whose `matches` flips and fires `change`.
function stubView(dark: boolean) {
  const query = Object.assign(new EventTarget(), { matches: dark }) as MediaQueryList & { matches: boolean };
  const removed = vi.spyOn(query, 'removeEventListener');
  const view = { matchMedia: (_media: string) => query } as Pick<Window, 'matchMedia'> as Window;
  const flip = (next: boolean) => {
    query.matches = next;
    query.dispatchEvent(new Event('change'));
  };
  return { view, removed, flip };
}

describe('system color scheme watcher', () => {
  it('applies dark or light from the initial prefers-color-scheme match', () => {
    const dark = document.createElement('div');
    const light = document.createElement('div');

    watchColorScheme(dark, stubView(true).view);
    watchColorScheme(light, stubView(false).view);

    expect(dark.dataset.theme).toBe('dark');
    expect(light.dataset.theme).toBe('light');
  });

  it('re-applies the theme when the system scheme changes', () => {
    const root = document.createElement('div');
    const { view, flip } = stubView(false);

    watchColorScheme(root, view);
    flip(true);
    expect(root.dataset.theme).toBe('dark');
    flip(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('stops following the system scheme once stopped', () => {
    const root = document.createElement('div');
    const { view, removed, flip } = stubView(false);

    const stop = watchColorScheme(root, view);
    stop();
    flip(true);

    expect(removed).toHaveBeenCalledWith('change', expect.any(Function));
    expect(root.dataset.theme).toBe('light');
  });

  it('applies light when matchMedia is unavailable', () => {
    const root = document.createElement('div');

    const stop = watchColorScheme(root, {} as Window);

    expect(root.dataset.theme).toBe('light');
    expect(() => stop()).not.toThrow();
  });
});
