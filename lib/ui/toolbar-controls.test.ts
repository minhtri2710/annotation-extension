// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbarControls } from './toolbar-controls';
import type { ToolbarPrefs } from './ui-prefs';

const TOOLBAR_WIDTH = 200;
const TOOLBAR_HEIGHT = 40;
const DEFAULT_LEFT = 584;
const DEFAULT_TOP = 544;

let toolbar: HTMLDivElement;
let viewport: { width: number; height: number };
let controls: ReturnType<typeof createToolbarControls> | undefined;

function setup(stored: ToolbarPrefs = { position: null }) {
  const prefs = {
    read: vi.fn<() => Promise<ToolbarPrefs>>().mockResolvedValue(stored),
    write: vi.fn<(prefs: ToolbarPrefs) => Promise<void>>().mockResolvedValue(undefined),
  };
  const onHide = vi.fn<() => void>();
  const onPositionChange = vi.fn<() => void>();
  controls = createToolbarControls({ toolbar, win: window, prefs, onHide, onPositionChange });
  const grip = toolbar.querySelector<HTMLButtonElement>('[data-annotation-toolbar-grip]')!;
  const collapse = toolbar.querySelector<HTMLButtonElement>('[data-annotation-toolbar-hide]')!;
  return { prefs, onHide, onPositionChange, grip, collapse };
}

function pointer(target: Element, type: string, clientX: number, clientY: number, button = 0) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button, clientX, clientY }));
}

function key(target: Element, keyName: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: keyName, shiftKey });
  target.dispatchEvent(event);
  return event;
}

function inlinePosition() {
  const { left, top, right, bottom } = toolbar.style;
  return { left, top, right, bottom };
}

beforeEach(() => {
  viewport = { width: 800, height: 600 };
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockImplementation(() => viewport.width);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => viewport.height);
  toolbar = document.createElement('div');
  const scan = document.createElement('button');
  scan.textContent = 'Scan';
  const badge = document.createElement('span');
  badge.setAttribute('data-annotation-badge', '');
  toolbar.append(scan, badge);
  document.body.append(toolbar);
  vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => {
    const left = toolbar.style.left ? Number.parseFloat(toolbar.style.left) : DEFAULT_LEFT;
    const top = toolbar.style.top ? Number.parseFloat(toolbar.style.top) : DEFAULT_TOP;
    return new DOMRect(left, top, TOOLBAR_WIDTH, TOOLBAR_HEIGHT);
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  controls?.destroy();
  controls = undefined;
  toolbar.remove();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  vi.restoreAllMocks();
});

describe('toolbar controls', () => {
  it('prepends the grip and appends the Hide toolbar button around existing toolbar content', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    expect(Array.from(toolbar.children).map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual([
      'Move toolbar',
      'Scan',
      '',
      'Hide toolbar on this tab',
    ]);
    expect(toolbar.firstElementChild).toBe(grip);
    expect(toolbar.lastElementChild).toBe(collapse);
    expect(grip.type).toBe('button');
    expect(grip.getAttribute('aria-label')).toBe('Move toolbar');
    expect(collapse.type).toBe('button');
    expect(collapse.hasAttribute('aria-expanded')).toBe(false);
    expect(collapse.hasAttribute('aria-pressed')).toBe(false);
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
  });

  it('draws the grip and the Hide toolbar button as icons with a name and a title and no visible text', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    for (const control of [grip, collapse]) {
      expect(control.textContent).toBe('');
      expect(control.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(control.querySelector('svg')?.getAttribute('focusable')).toBe('false');
      expect(control.title).toBe(control.getAttribute('aria-label'));
    }
    expect(collapse.title).toBe('Hide toolbar on this tab');
    expect(grip.title).toBe('Move toolbar');
  });

  it('calls onHide once per click on the Hide toolbar button and leaves the bar, its position and the stored prefs alone', async () => {
    const { prefs, onHide, onPositionChange, collapse } = setup({ position: { x: 100, y: 100 } });
    await controls!.ready;
    collapse.click();
    expect(onHide).toHaveBeenCalledTimes(1);
    collapse.click();
    expect(onHide).toHaveBeenCalledTimes(2);
    expect(toolbar.hidden).toBe(false);
    expect(inlinePosition()).toEqual({ left: '100px', top: '100px', right: 'auto', bottom: 'auto' });
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(prefs.write).not.toHaveBeenCalled();
  });

  it('stops calling onHide once destroyed, even from a button reference kept by the page', async () => {
    const { onHide, collapse } = setup();
    await controls!.ready;
    controls!.destroy();
    collapse.click();
    expect(onHide).not.toHaveBeenCalled();
  });

  it('applies the stored position clamped to the viewport without notifying', async () => {
    const { prefs, onPositionChange } = setup({ position: { x: 900, y: 20 } });
    await controls!.ready;
    expect(inlinePosition()).toEqual({ left: '592px', top: '20px', right: 'auto', bottom: 'auto' });
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(prefs.write).not.toHaveBeenCalled();
  });

  it('drags by the pointer delta with pointer capture and persists on pointerup', async () => {
    const { prefs, grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1);
    expect(grip.hasAttribute('data-dragging')).toBe(true);
    pointer(grip, 'pointermove', 500, 460);
    expect(inlinePosition()).toEqual({ left: '484px', top: '444px', right: 'auto', bottom: 'auto' });
    expect(prefs.write).not.toHaveBeenCalled();
    pointer(grip, 'pointerup', 500, 460);
    expect(grip.hasAttribute('data-dragging')).toBe(false);
    expect(prefs.write).toHaveBeenCalledWith({ position: { x: 484, y: 444 } });
  });

  it('clamps a drag at every viewport edge', async () => {
    const { grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    pointer(grip, 'pointermove', -1000, 560);
    expect(inlinePosition().left).toBe('8px');
    pointer(grip, 'pointermove', 5000, 560);
    expect(inlinePosition().left).toBe('592px');
    pointer(grip, 'pointermove', 600, -1000);
    expect(inlinePosition().top).toBe('8px');
    pointer(grip, 'pointermove', 600, 5000);
    expect(inlinePosition().top).toBe('552px');
    pointer(grip, 'pointerup', 600, 5000);
  });

  it('clamps a drag inside the viewport minus classic scrollbars, not the window size', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewport.width + 15);
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewport.height + 15);
    const { grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    pointer(grip, 'pointermove', 5000, 5000);
    expect(inlinePosition()).toEqual({
      left: `${viewport.width - TOOLBAR_WIDTH - 8}px`,
      top: `${viewport.height - TOOLBAR_HEIGHT - 8}px`,
      right: 'auto',
      bottom: 'auto',
    });
    pointer(grip, 'pointerup', 5000, 5000);
  });

  it('persists nothing for a press without movement or a non-primary button', async () => {
    const { prefs, grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    pointer(grip, 'pointermove', 600, 560);
    pointer(grip, 'pointerup', 600, 560);
    pointer(grip, 'pointerdown', 600, 560, 2);
    pointer(grip, 'pointermove', 400, 400);
    pointer(grip, 'pointerup', 400, 400);
    expect(prefs.write).not.toHaveBeenCalled();
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
  });

  it('moves with arrow keys, 64 px with Shift, clamps, persists, and Home returns to the corner', async () => {
    const { prefs, grip } = setup();
    await controls!.ready;
    expect(key(grip, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(inlinePosition()).toEqual({ left: '568px', top: '544px', right: 'auto', bottom: 'auto' });
    expect(prefs.write).toHaveBeenLastCalledWith({ position: { x: 568, y: 544 } });
    key(grip, 'ArrowUp', true);
    expect(inlinePosition().top).toBe('480px');
    key(grip, 'ArrowRight', true);
    expect(inlinePosition().left).toBe('592px');
    key(grip, 'ArrowDown');
    key(grip, 'ArrowDown', true);
    expect(inlinePosition().top).toBe('552px');
    expect(prefs.write).toHaveBeenLastCalledWith({ position: { x: 592, y: 552 } });
    expect(key(grip, 'Home').defaultPrevented).toBe(true);
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(prefs.write).toHaveBeenLastCalledWith({ position: null });
    expect(key(grip, 'a').defaultPrevented).toBe(false);
    expect(prefs.write).toHaveBeenCalledTimes(6);
  });

  it('focuses the grip on a primary pointerdown so a following arrow key moves the toolbar', async () => {
    const { grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    pointer(grip, 'pointerup', 600, 560);
    expect(grip.ownerDocument.activeElement).toBe(grip);
    key(grip.ownerDocument.activeElement!, 'ArrowLeft');
    expect(inlinePosition().left).toBe('568px');
  });

  it('re-clamps a custom position on resize without persisting', async () => {
    const { prefs } = setup({ position: { x: 500, y: 400 } });
    await controls!.ready;
    viewport = { width: 400, height: 300 };
    window.dispatchEvent(new Event('resize'));
    expect(inlinePosition()).toEqual({ left: '192px', top: '252px', right: 'auto', bottom: 'auto' });
    expect(prefs.write).not.toHaveBeenCalled();
  });

  it('keeps the default corner on resize', async () => {
    setup();
    await controls!.ready;
    viewport = { width: 400, height: 300 };
    window.dispatchEvent(new Event('resize'));
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
  });

  it('destroy removes both buttons, the listeners and the inline position', async () => {
    const { prefs, grip, collapse } = setup({ position: { x: 100, y: 100 } });
    await controls!.ready;
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    controls!.destroy();
    controls = undefined;
    expect(grip.isConnected).toBe(false);
    expect(collapse.isConnected).toBe(false);
    expect(Array.from(toolbar.children).map((child) => child.textContent)).toEqual(['Scan', '']);
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    viewport = { width: 100, height: 100 };
    window.dispatchEvent(new Event('resize'));
    pointer(grip, 'pointerdown', 110, 110);
    pointer(grip, 'pointermove', 10, 10);
    pointer(grip, 'pointerup', 10, 10);
    key(grip, 'ArrowLeft');
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(prefs.write).not.toHaveBeenCalled();
  });

  it('does not apply stored prefs that resolve after destroy', async () => {
    const { prefs } = setup({ position: { x: 100, y: 100 } });
    controls!.destroy();
    const ready = controls!.ready;
    controls = undefined;
    await ready;
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(prefs.read).toHaveBeenCalledTimes(1);
  });

  it('reports position changes on drag moves, arrows, Home and a changing resize', async () => {
    const { onPositionChange, grip } = setup();
    await controls!.ready;
    pointer(grip, 'pointerdown', 600, 560);
    pointer(grip, 'pointermove', 500, 460);
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(inlinePosition().left).toBe('484px');
    pointer(grip, 'pointermove', 490, 450);
    pointer(grip, 'pointerup', 490, 450);
    expect(onPositionChange).toHaveBeenCalledTimes(2);
    key(grip, 'ArrowLeft');
    key(grip, 'ArrowDown', true);
    expect(onPositionChange).toHaveBeenCalledTimes(4);
    key(grip, 'a');
    expect(onPositionChange).toHaveBeenCalledTimes(4);
    window.dispatchEvent(new Event('resize'));
    expect(onPositionChange).toHaveBeenCalledTimes(4);
    viewport = { width: 400, height: 300 };
    window.dispatchEvent(new Event('resize'));
    expect(onPositionChange).toHaveBeenCalledTimes(5);
    key(grip, 'Home');
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(onPositionChange).toHaveBeenCalledTimes(6);
  });

  it('does not report a position change for the start-up apply or a press without movement', async () => {
    const { onPositionChange, grip } = setup({ position: { x: 900, y: 20 } });
    await controls!.ready;
    expect(inlinePosition().left).toBe('592px');
    pointer(grip, 'pointerdown', 600, 30);
    pointer(grip, 'pointermove', 600, 30);
    pointer(grip, 'pointerup', 600, 30);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('moves focus and the tab stop with Left, Right, Home and End, wrapping at both ends', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    const scan = toolbar.querySelector<HTMLButtonElement>('button:not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-hide])')!;
    scan.focus();
    expect(key(scan, 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(collapse);
    expect([grip, scan, collapse].map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
    key(collapse, 'ArrowRight');
    expect(document.activeElement).toBe(grip);
    key(scan, 'ArrowLeft');
    expect(document.activeElement).toBe(grip);
    collapse.focus();
    key(collapse, 'Home');
    expect(document.activeElement).toBe(grip);
    key(scan, 'End');
    expect(document.activeElement).toBe(collapse);
    key(grip, 'End');
    expect(document.activeElement).toBe(collapse);
    expect(key(collapse, 'a').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(collapse);
  });

  it('keeps the grip arrow keys for moving the toolbar, not focus', async () => {
    const { grip } = setup();
    await controls!.ready;
    grip.focus();
    key(grip, 'ArrowLeft');
    expect(document.activeElement).toBe(grip);
    expect(inlinePosition().left).toBe(`${DEFAULT_LEFT - 16}px`);
  });

  it('keeps the tab stop on the button that last took focus', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    collapse.focus();
    expect([grip.tabIndex, collapse.tabIndex]).toEqual([-1, 0]);
    grip.focus();
    expect([grip.tabIndex, collapse.tabIndex]).toEqual([0, -1]);
  });

  it('adds later toolbar buttons to the roving set without adding tab stops', async () => {
    const { collapse } = setup();
    await controls!.ready;
    const late = document.createElement('button');
    late.textContent = 'Annotate';
    collapse.before(late);
    await vi.waitFor(() => expect(late.tabIndex).toBe(-1));
    const tabStops = [...toolbar.querySelectorAll('button')].filter((button) => button.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    late.focus();
    key(late, 'ArrowRight');
    expect(document.activeElement).toBe(collapse);
  });

  it('skips a hidden or disabled button and moves a tab stop that left the set to a shown button', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    const scan = toolbar.querySelector<HTMLButtonElement>('button:not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-hide])')!;
    const middle = document.createElement('button');
    collapse.before(middle);
    await vi.waitFor(() => expect(middle.tabIndex).toBe(-1));
    scan.hidden = true;
    await vi.waitFor(() => expect(middle.tabIndex).toBe(0));
    expect(scan.tabIndex).toBe(-1);
    middle.disabled = true;
    await vi.waitFor(() => expect(collapse.tabIndex).toBe(0));
    expect([grip.tabIndex, scan.tabIndex, middle.tabIndex]).toEqual([-1, -1, -1]);
    grip.focus();
    key(grip, 'End');
    expect(document.activeElement).toBe(collapse);
    key(collapse, 'ArrowLeft');
    expect(document.activeElement).toBe(grip);
  });

  it('destroy stops roving and clears the tab stops it set', async () => {
    setup();
    await controls!.ready;
    const scan = toolbar.querySelector<HTMLButtonElement>('button:not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-hide])')!;
    controls!.destroy();
    controls = undefined;
    expect(scan.hasAttribute('tabindex')).toBe(false);
    scan.focus();
    expect(key(scan, 'ArrowRight').defaultPrevented).toBe(false);
  });
});
