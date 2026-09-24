import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  CAPTURE_SHORTCUT_MESSAGE,
  CAPTURE_STATE_MESSAGE,
  CAPTURE_TOGGLE_MESSAGE,
  isCaptureShortcutMessage,
  isCaptureStateMessage,
  isCaptureToggleMessage,
  readCaptureShortcut,
} from './activation';

describe('isCaptureToggleMessage', () => {
  it('accepts the toggle message, with or without extra fields', () => {
    expect(CAPTURE_TOGGLE_MESSAGE).toBe('capture.toggle');
    expect(isCaptureToggleMessage({ type: 'capture.toggle' })).toBe(true);
    expect(isCaptureToggleMessage({ type: 'capture.toggle', extra: 1 })).toBe(true);
  });

  it('rejects other message types and a missing type', () => {
    expect(isCaptureToggleMessage({ type: 'capture.start' })).toBe(false);
    expect(isCaptureToggleMessage({ type: 'Capture.Toggle' })).toBe(false);
    expect(isCaptureToggleMessage({})).toBe(false);
  });

  it('rejects arrays, null and non-objects', () => {
    const toggleArray = Object.assign(['capture.toggle'], { type: 'capture.toggle' });
    expect(isCaptureToggleMessage(toggleArray)).toBe(false);
    expect(isCaptureToggleMessage(null)).toBe(false);
    for (const value of [undefined, 'capture.toggle', 0, true]) {
      expect(isCaptureToggleMessage(value)).toBe(false);
    }
  });
});

describe('isCaptureStateMessage', () => {
  it('accepts the state message', () => {
    expect(CAPTURE_STATE_MESSAGE).toBe('capture.state');
    expect(isCaptureStateMessage({ type: 'capture.state' })).toBe(true);
  });

  it('rejects the toggle message, another type and non-records', () => {
    expect(isCaptureStateMessage({ type: CAPTURE_TOGGLE_MESSAGE })).toBe(false);
    expect(isCaptureStateMessage({ type: 'Capture.State' })).toBe(false);
    expect(isCaptureStateMessage(Object.assign(['capture.state'], { type: 'capture.state' }))).toBe(false);
    for (const value of [null, undefined, 'capture.state', 0]) {
      expect(isCaptureStateMessage(value)).toBe(false);
    }
  });
});

describe('isCaptureShortcutMessage', () => {
  it('accepts the shortcut message', () => {
    expect(CAPTURE_SHORTCUT_MESSAGE).toBe('capture.shortcut');
    expect(isCaptureShortcutMessage({ type: 'capture.shortcut' })).toBe(true);
  });

  it('rejects the other capture messages, another type and non-records', () => {
    expect(isCaptureShortcutMessage({ type: CAPTURE_TOGGLE_MESSAGE })).toBe(false);
    expect(isCaptureShortcutMessage({ type: CAPTURE_STATE_MESSAGE })).toBe(false);
    expect(isCaptureShortcutMessage({ type: 'Capture.Shortcut' })).toBe(false);
    expect(isCaptureShortcutMessage({})).toBe(false);
    expect(isCaptureShortcutMessage(Object.assign(['capture.shortcut'], { type: 'capture.shortcut' }))).toBe(false);
    for (const value of [null, undefined, 'capture.shortcut', 0]) {
      expect(isCaptureShortcutMessage(value)).toBe(false);
    }
  });
});

describe('readCaptureShortcut', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the shortcut message and resolves the reply shortcut, the empty string included', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ shortcut: 'Alt+Q' } as never);
    await expect(readCaptureShortcut()).resolves.toBe('Alt+Q');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'capture.shortcut' });

    sendMessage.mockResolvedValue({ shortcut: '' } as never);
    await expect(readCaptureShortcut()).resolves.toBe('');
  });

  it('rejects an error response and a reply without a string shortcut', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'no commands' } as never);
    await expect(readCaptureShortcut()).rejects.toThrow('no commands');

    for (const response of [{}, { shortcut: 1 }, undefined]) {
      sendMessage.mockResolvedValue(response as never);
      await expect(readCaptureShortcut()).rejects.toThrow('Invalid capture shortcut response');
    }
  });
});
