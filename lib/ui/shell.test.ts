// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { OVERLAY_STYLES } from './styles';
import { buildOverlayShell, positionPopover } from './shell';

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

  it('positions popovers below or above and clamps them to the viewport', () => {
    expect(
      positionPopover(
        { x: 40, y: 50, width: 100, height: 20 },
        { width: 200, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ top: 78, left: 40 });
    expect(
      positionPopover(
        { x: 20, y: 220, width: 100, height: 20 },
        { width: 200, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ top: 112, left: 20 });
    expect(
      positionPopover(
        { x: -30, y: 50, width: 100, height: 20 },
        { width: 80, height: 40 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ top: 78, left: 10 });
    expect(
      positionPopover(
        { x: 280, y: 50, width: 100, height: 20 },
        { width: 80, height: 40 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ top: 78, left: 210 });
    expect(
      positionPopover(
        { x: 100, y: 20, width: 100, height: 10 },
        { width: 80, height: 50 },
        { width: 300, height: 60 },
      ),
    ).toEqual({ top: 10, left: 100 });
  });
});
