// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_STYLES } from './styles';
import {
  buildOverlayShell,
  clampToolbarPosition,
  createLiveRegion,
  createPanelAnchor,
  keepPanelFocus,
  positionPopover,
} from './shell';
import { applyThemeMode } from './theme';

describe('overlay shell', () => {
  it('builds the toolbar and panel mounts with the injected stylesheet and no theme of its own', () => {
    const container = document.createElement('div');

    const shell = buildOverlayShell(container);

    expect(shell.root).toBe(container.querySelector('[data-annotation-shell]'));
    expect(shell.root.dataset.theme).toBeUndefined();
    applyThemeMode(shell.root, 'dark');
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

  it('clamps the toolbar inside the viewport margin at every edge', () => {
    const size = { width: 200, height: 40 };
    const viewport = { width: 800, height: 600 };
    expect(clampToolbarPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
    expect(clampToolbarPosition({ x: -50, y: 100 }, size, viewport)).toEqual({ x: 8, y: 100 });
    expect(clampToolbarPosition({ x: 700, y: 100 }, size, viewport)).toEqual({ x: 592, y: 100 });
    expect(clampToolbarPosition({ x: 100, y: -5 }, size, viewport)).toEqual({ x: 100, y: 8 });
    expect(clampToolbarPosition({ x: 100, y: 590 }, size, viewport)).toEqual({ x: 100, y: 552 });
    expect(clampToolbarPosition({ x: 900, y: 900 }, size, viewport, 16)).toEqual({ x: 584, y: 544 });
  });

  it('pins the toolbar to the margin when the viewport is smaller than the toolbar', () => {
    expect(clampToolbarPosition({ x: 50, y: 50 }, { width: 200, height: 40 }, { width: 150, height: 30 })).toEqual({
      x: 8,
      y: 8,
    });
  });

  it('exposes the toolbar mount as a named toolbar', () => {
    const shell = buildOverlayShell(document.createElement('div'));
    expect(shell.toolbar.getAttribute('role')).toBe('toolbar');
    expect(shell.toolbar.getAttribute('aria-label')).toBe('Annotation tools');
  });

  it('gives the panel mount a region role', () => {
    const shell = buildOverlayShell(document.createElement('div'));
    expect(shell.panel.getAttribute('role')).toBe('region');
  });

  it('refocuses the equivalent control of the same annotation after the panel re-renders', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const renderItems = () => {
      panel.replaceChildren();
      const heading = document.createElement('h2');
      heading.tabIndex = -1;
      panel.append(heading);
      for (const id of ['a', 'b']) {
        const item = document.createElement('article');
        item.dataset.annotationId = id;
        const button = document.createElement('button');
        button.dataset.annotationEdit = '';
        item.append(button);
        panel.append(item);
      }
    };
    renderItems();
    panel.querySelector<HTMLButtonElement>('[data-annotation-id="b"] [data-annotation-edit]')!.focus();
    const restore = keepPanelFocus(panel);
    renderItems();
    restore();
    expect(document.activeElement).toBe(panel.querySelector('[data-annotation-id="b"] [data-annotation-edit]'));
    panel.remove();
  });

  it('falls back to the panel heading when the focused control is gone', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const button = document.createElement('button');
    button.dataset.annotationClear = '';
    panel.append(button);
    button.focus();
    const restore = keepPanelFocus(panel);
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    panel.replaceChildren(heading);
    restore();
    expect(document.activeElement).toBe(heading);
    panel.remove();
  });

  it('leaves focus alone when it was outside the panel', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('input');
    document.body.append(panel, outside);
    outside.focus();
    const restore = keepPanelFocus(panel);
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    panel.replaceChildren(heading);
    restore();
    expect(document.activeElement).toBe(outside);
    panel.remove();
    outside.remove();
  });
});

describe('panel anchor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function setup(viewport: { width: number; height: number }, size: { width: number; height: number }) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(viewport.width);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(viewport.height);
    const panel = document.createElement('div');
    document.body.append(panel);
    const rect = vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect(size));
    const toolbar = document.createElement('div');
    document.body.append(toolbar);
    return { panel, rect, toolbar };
  }

  it('places the panel fixed at the popover position and caps its height to the room below that top', () => {
    const { panel, toolbar } = setup({ width: 400, height: 300 }, { width: 200, height: 100 });
    const anchor = createPanelAnchor(panel, toolbar);

    anchor.place(() => ({ x: 40, y: 50, width: 100, height: 20 }));

    expect(panel.style.position).toBe('fixed');
    expect(panel.style.top).toBe('78px');
    expect(panel.style.left).toBe('40px');
    expect(panel.style.right).toBe('auto');
    expect(panel.style.bottom).toBe('auto');
    expect(panel.style.maxHeight).toBe('212px');
    anchor.destroy();
  });

  it('measures the uncapped panel and re-places it on window resize', () => {
    const { panel, rect, toolbar } = setup({ width: 400, height: 300 }, { width: 200, height: 100 });
    const anchor = createPanelAnchor(panel, toolbar);
    anchor.place(() => ({ x: 40, y: 50, width: 100, height: 20 }));
    let measuredCap: string | undefined;
    rect.mockImplementation(() => {
      measuredCap = panel.style.maxHeight;
      return DOMRect.fromRect({ width: 200, height: 250 });
    });

    window.dispatchEvent(new Event('resize'));

    expect(measuredCap).toBe('');
    expect(panel.style.top).toBe('10px');
    expect(panel.style.maxHeight).toBe('280px');
    anchor.destroy();
  });

  it('clears the placement and stops following resizes once cleared or destroyed', () => {
    const { panel, rect, toolbar } = setup({ width: 400, height: 300 }, { width: 200, height: 100 });
    const anchor = createPanelAnchor(panel, toolbar);
    anchor.place(() => ({ x: 40, y: 50, width: 100, height: 20 }));

    anchor.clear();
    expect(panel.getAttribute('style') ?? '').toBe('');
    rect.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(rect).not.toHaveBeenCalled();

    anchor.place(() => ({ x: 40, y: 50, width: 100, height: 20 }));
    anchor.destroy();
    expect(panel.getAttribute('style') ?? '').toBe('');
    rect.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(rect).not.toHaveBeenCalled();
  });

  it('caps the panel above a toolbar below it and starts it under a toolbar across its top', () => {
    const { panel, toolbar } = setup({ width: 400, height: 300 }, { width: 200, height: 100 });
    const bar = vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 250, width: 280, height: 40 }));
    const anchor = createPanelAnchor(panel, toolbar);

    anchor.place(() => ({ x: 40, y: 50, width: 100, height: 20 }));
    expect(panel.style.top).toBe('78px');
    expect(panel.style.maxHeight).toBe('162px');

    bar.mockReturnValue(DOMRect.fromRect({ x: 100, y: 60, width: 280, height: 40 }));
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.top).toBe('110px');
    expect(panel.style.maxHeight).toBe('180px');

    bar.mockReturnValue(DOMRect.fromRect({ x: 300, y: 250, width: 90, height: 40 }));
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.top).toBe('78px');
    expect(panel.style.maxHeight).toBe('212px');
    anchor.destroy();
  });

  it('scrolls a control that takes focus fully into view inside the panel on the next frame', async () => {
    const { panel, toolbar } = setup({ width: 400, height: 300 }, { width: 200, height: 100 });
    const control = document.createElement('button');
    panel.append(control);
    const scrollIntoView = vi.fn();
    control.scrollIntoView = scrollIntoView;
    const anchor = createPanelAnchor(panel, toolbar);

    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(scrollIntoView).not.toHaveBeenCalled();
    await frame();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

    anchor.destroy();
    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await frame();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('createLiveRegion', () => {
  it('builds a status paragraph marked as the annotation live region', () => {
    const { element } = createLiveRegion(document);

    expect(element.localName).toBe('p');
    expect(element.getAttribute('role')).toBe('status');
    expect(element.hasAttribute('data-annotation-live')).toBe(true);
  });

  it('writes the announced text', () => {
    const live = createLiveRegion(document);

    live.announce('Saved.');

    expect(live.element.textContent).toBe('Saved.');
  });

  it('does not rewrite the region when the same text is announced again', () => {
    const live = createLiveRegion(document);
    live.announce('Saved.');
    const node = live.element.firstChild;

    live.announce('Saved.');

    expect(live.element.firstChild).toBe(node);
  });
});
