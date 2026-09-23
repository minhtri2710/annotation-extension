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

function setup(stored: ToolbarPrefs = { position: null, collapsed: false }) {
  const prefs = {
    read: vi.fn<() => Promise<ToolbarPrefs>>().mockResolvedValue(stored),
    write: vi.fn<(prefs: ToolbarPrefs) => Promise<void>>().mockResolvedValue(undefined),
  };
  const onCollapsedChange = vi.fn<(collapsed: boolean) => void>();
  const onPositionChange = vi.fn<() => void>();
  controls = createToolbarControls({ toolbar, win: window, prefs, onCollapsedChange, onPositionChange });
  const grip = toolbar.querySelector<HTMLButtonElement>('[data-annotation-toolbar-grip]')!;
  const collapse = toolbar.querySelector<HTMLButtonElement>('[data-annotation-toolbar-collapse]')!;
  return { prefs, onCollapsedChange, onPositionChange, grip, collapse };
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
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewport.width);
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewport.height);
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
  it('prepends the grip and appends the collapse button around existing toolbar content', async () => {
    const { grip, collapse } = setup();
    await controls!.ready;
    expect(Array.from(toolbar.children).map((child) => child.textContent)).toEqual(['⠿', 'Scan', '', 'Hide']);
    expect(toolbar.firstElementChild).toBe(grip);
    expect(toolbar.lastElementChild).toBe(collapse);
    expect(grip.type).toBe('button');
    expect(grip.getAttribute('aria-label')).toBe('Move toolbar');
    expect(collapse.type).toBe('button');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(toolbar.hasAttribute('data-collapsed')).toBe(false);
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
  });

  it('applies the stored position clamped to the viewport and the stored collapsed state without notifying', async () => {
    const { prefs, onCollapsedChange, collapse } = setup({ position: { x: 900, y: 20 }, collapsed: true });
    await controls!.ready;
    expect(inlinePosition()).toEqual({ left: '592px', top: '20px', right: 'auto', bottom: 'auto' });
    expect(toolbar.hasAttribute('data-collapsed')).toBe(true);
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(collapse.textContent).toBe('Show');
    expect(onCollapsedChange).not.toHaveBeenCalled();
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
    expect(prefs.write).toHaveBeenCalledWith({ position: { x: 484, y: 444 }, collapsed: false });
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
    expect(prefs.write).toHaveBeenLastCalledWith({ position: { x: 568, y: 544 }, collapsed: false });
    key(grip, 'ArrowUp', true);
    expect(inlinePosition().top).toBe('480px');
    key(grip, 'ArrowRight', true);
    expect(inlinePosition().left).toBe('592px');
    key(grip, 'ArrowDown');
    key(grip, 'ArrowDown', true);
    expect(inlinePosition().top).toBe('552px');
    expect(prefs.write).toHaveBeenLastCalledWith({ position: { x: 592, y: 552 }, collapsed: false });
    expect(key(grip, 'Home').defaultPrevented).toBe(true);
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(prefs.write).toHaveBeenLastCalledWith({ position: null, collapsed: false });
    expect(key(grip, 'a').defaultPrevented).toBe(false);
    expect(prefs.write).toHaveBeenCalledTimes(6);
  });

  it('re-clamps a custom position on resize without persisting', async () => {
    const { prefs } = setup({ position: { x: 500, y: 400 }, collapsed: false });
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

  it('toggles collapse, persists it, then notifies', async () => {
    const { prefs, onCollapsedChange, collapse } = setup({ position: { x: 100, y: 100 }, collapsed: false });
    await controls!.ready;
    prefs.write.mockImplementation(async () => {
      expect(onCollapsedChange).not.toHaveBeenCalled();
    });
    collapse.click();
    expect(toolbar.hasAttribute('data-collapsed')).toBe(true);
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(collapse.textContent).toBe('Show');
    expect(prefs.write).toHaveBeenCalledWith({ position: { x: 100, y: 100 }, collapsed: true });
    await vi.waitFor(() => expect(onCollapsedChange).toHaveBeenCalledWith(true));
    collapse.click();
    expect(toolbar.hasAttribute('data-collapsed')).toBe(false);
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.textContent).toBe('Hide');
    expect(prefs.write).toHaveBeenLastCalledWith({ position: { x: 100, y: 100 }, collapsed: false });
    await vi.waitFor(() => expect(onCollapsedChange).toHaveBeenLastCalledWith(false));
  });

  it('destroy removes both buttons, the listeners and the inline position', async () => {
    const { prefs, grip, collapse } = setup({ position: { x: 100, y: 100 }, collapsed: false });
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
    const { prefs } = setup({ position: { x: 100, y: 100 }, collapsed: true });
    controls!.destroy();
    const ready = controls!.ready;
    controls = undefined;
    await ready;
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(toolbar.hasAttribute('data-collapsed')).toBe(false);
    expect(prefs.read).toHaveBeenCalledTimes(1);
  });

  it('reports position changes on drag moves, arrows, Home, a changing resize and a collapse re-clamp', async () => {
    const { onPositionChange, grip, collapse } = setup();
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
    collapse.click();
    expect(onPositionChange).toHaveBeenCalledTimes(6);
    key(grip, 'Home');
    expect(inlinePosition()).toEqual({ left: '', top: '', right: '', bottom: '' });
    expect(onPositionChange).toHaveBeenCalledTimes(7);
  });

  it('does not report a position change for the start-up apply or a press without movement', async () => {
    const { onPositionChange, grip } = setup({ position: { x: 900, y: 20 }, collapsed: false });
    await controls!.ready;
    expect(inlinePosition().left).toBe('592px');
    pointer(grip, 'pointerdown', 600, 30);
    pointer(grip, 'pointermove', 600, 30);
    pointer(grip, 'pointerup', 600, 30);
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});
