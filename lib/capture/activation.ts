import { browser } from 'wxt/browser';
import { sendBackgroundRequest } from '../annotation-messages';
import { isRecord } from '../guards';

export const CAPTURE_TOGGLE_MESSAGE = 'capture.toggle' as const;

export interface CaptureToggleMessage {
  type: typeof CAPTURE_TOGGLE_MESSAGE;
}

export function isCaptureToggleMessage(value: unknown): value is CaptureToggleMessage {
  return isRecord(value) && value.type === CAPTURE_TOGGLE_MESSAGE;
}

export const CAPTURE_STATE_MESSAGE = 'capture.state' as const;

export interface CaptureStateMessage {
  type: typeof CAPTURE_STATE_MESSAGE;
}

export function isCaptureStateMessage(value: unknown): value is CaptureStateMessage {
  return isRecord(value) && value.type === CAPTURE_STATE_MESSAGE;
}

export const CAPTURE_SHORTCUT_MESSAGE = 'capture.shortcut' as const;

export interface CaptureShortcutMessage {
  type: typeof CAPTURE_SHORTCUT_MESSAGE;
}

export function isCaptureShortcutMessage(value: unknown): value is CaptureShortcutMessage {
  return isRecord(value) && value.type === CAPTURE_SHORTCUT_MESSAGE;
}

/** Resolves the capture command's shortcut; the empty string means none is set. */
export async function readCaptureShortcut(): Promise<string> {
  const response = await sendBackgroundRequest<CaptureShortcutMessage, { shortcut: string }>(
    { type: CAPTURE_SHORTCUT_MESSAGE },
    (value): value is { shortcut: string } => isRecord(value) && typeof value.shortcut === 'string',
    'Invalid capture shortcut response',
  );
  return response.shortcut;
}

/** Reads the capture command's shortcut straight from the commands API; the empty string means none is set. */
export async function lookupCaptureShortcut(): Promise<string> {
  const commands = await browser.commands.getAll();
  return commands.find((command) => command.name === CAPTURE_TOGGLE_MESSAGE)?.shortcut ?? '';
}

export const SHORTCUT_SETTINGS = "your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager)";

export function captureShortcutHint(shortcut: string): string {
  return shortcut
    ? `Shortcut: ${shortcut}`
    : `No keyboard shortcut is set; you can add one in ${SHORTCUT_SETTINGS}.`;
}
