import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  CAPTURE_SHORTCUT_MESSAGE,
  CAPTURE_STATE_MESSAGE,
  CAPTURE_TOGGLE_MESSAGE,
  captureShortcutHint,
  isCaptureShortcutMessage,
  isCaptureStateMessage,
  isCaptureToggleMessage,
  lookupCaptureShortcut,
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

describe('lookupCaptureShortcut', () => {
  it('returns the capture.toggle shortcut when another command is listed first', async () => {
    vi.spyOn(browser.commands, 'getAll').mockResolvedValue([
      { name: '_execute_action', shortcut: 'Alt+P' },
      { name: 'capture.toggle', shortcut: 'Alt+Q' },
    ] as never);
    await expect(lookupCaptureShortcut()).resolves.toBe('Alt+Q');
  });

  it('returns the empty string for a capture.toggle command without a shortcut and for an absent command', async () => {
    const getAll = vi.spyOn(browser.commands, 'getAll').mockResolvedValue([
      { name: '_execute_action', shortcut: 'Alt+P' },
      { name: 'capture.toggle' },
    ] as never);
    await expect(lookupCaptureShortcut()).resolves.toBe('');

    getAll.mockResolvedValue([{ name: '_execute_action', shortcut: 'Alt+P' }] as never);
    await expect(lookupCaptureShortcut()).resolves.toBe('');
  });

  it('rejects when getAll rejects', async () => {
    vi.spyOn(browser.commands, 'getAll').mockRejectedValue(new Error('no commands'));
    await expect(lookupCaptureShortcut()).rejects.toThrow('no commands');
  });

  const lookupFor = async (shortcut: string): Promise<string> => {
    vi.spyOn(browser.commands, 'getAll').mockResolvedValue([{ name: 'capture.toggle', shortcut }] as never);
    return lookupCaptureShortcut();
  };

  it('spells out Period in the Firefox default shortcut', async () => {
    await expect(lookupFor('Ctrl+Shift+Period')).resolves.toBe('Ctrl+Shift+.');
  });

  it('spells out MacCtrl as Control', async () => {
    await expect(lookupFor('MacCtrl+Shift+Period')).resolves.toBe('Control+Shift+.');
  });

  it('spells out Comma, PageDown and PageUp', async () => {
    await expect(lookupFor('Alt+Comma')).resolves.toBe('Alt+,');
    await expect(lookupFor('Ctrl+PageDown')).resolves.toBe('Ctrl+Page Down');
    await expect(lookupFor('Ctrl+PageUp')).resolves.toBe('Ctrl+Page Up');
  });

  it('passes Chrome display strings and ordinary keys through unchanged', async () => {
    await expect(lookupFor('Ctrl+Shift+.')).resolves.toBe('Ctrl+Shift+.');
    await expect(lookupFor('⇧⌘.')).resolves.toBe('⇧⌘.');
    await expect(lookupFor('Command+Shift+Y')).resolves.toBe('Command+Shift+Y');
  });

  it('maps whole tokens only, leaving a token that merely contains a table key unchanged', async () => {
    await expect(lookupFor('Alt+MediaPlayPause')).resolves.toBe('Alt+MediaPlayPause');
    await expect(lookupFor('Ctrl+Shift+Periods')).resolves.toBe('Ctrl+Shift+Periods');
  });
});

describe('captureShortcutHint', () => {
  it('names a set shortcut', () => {
    expect(captureShortcutHint('Alt+Q')).toBe('Shortcut: Alt+Q');
  });

  it('points to the shortcut settings in plain text, naming no key, when none is set', () => {
    const hint = captureShortcutHint('');
    expect(hint).toBe("No keyboard shortcut is set; you can add one in your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager).");
    expect(hint).toContain('chrome://extensions/shortcuts');
    expect(hint).toContain('Manage Extension Shortcuts');
    expect(hint).not.toMatch(/\b(Ctrl|Control|Alt|Shift|Cmd|Command|MacCtrl)\b|⌘|⇧/);
  });
});
