// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { OVERLAY_STYLES } from './styles';
import { buildOverlayShell } from './shell';

describe('overlay shell', () => {
  it('builds the themed toolbar and panel mounts with the injected stylesheet', () => {
    const container = document.createElement('div');

    const shell = buildOverlayShell(container, { theme: 'dark' });

    expect(shell.root).toBe(container.querySelector('[data-annotation-shell]'));
    expect(shell.root.dataset.theme).toBe('dark');
    expect(shell.toolbar.dataset.annotationMount).toBe('toolbar');
    expect(shell.panel.dataset.annotationMount).toBe('panel');
    expect(Array.from(shell.root.children)).toEqual([shell.toolbar, shell.panel]);
    expect(container.querySelector('style')?.textContent).toBe(OVERLAY_STYLES);
  });

  it('keeps toolbar and panel mounts as direct shell children', () => {
    const container = document.createElement('div');

    const shell = buildOverlayShell(container);

    expect(shell.toolbar.parentElement).toBe(shell.root);
    expect(shell.panel.parentElement).toBe(shell.root);
    expect(shell.root.querySelectorAll('[data-annotation-mount]')).toHaveLength(2);
  });
});
