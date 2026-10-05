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

export async function readCaptureShortcut(): Promise<string> {
  const response = await sendBackgroundRequest<CaptureShortcutMessage, { shortcut: string }>(
    { type: CAPTURE_SHORTCUT_MESSAGE },
    (value): value is { shortcut: string } => isRecord(value) && typeof value.shortcut === 'string',
    'Invalid capture shortcut response',
  );
  return response.shortcut;
}

const READABLE_SHORTCUT_KEYS: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  MacCtrl: 'Control',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

export async function lookupCaptureShortcut(): Promise<string> {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((command) => command.name === CAPTURE_TOGGLE_MESSAGE)?.shortcut ?? '';
  return shortcut
    .split('+')
    .map((token) => (Object.hasOwn(READABLE_SHORTCUT_KEYS, token) ? READABLE_SHORTCUT_KEYS[token] : token))
    .join('+');
}

export const SHORTCUT_SETTINGS = "your browser's extension shortcut settings (chrome://extensions/shortcuts in Chrome, Manage Extension Shortcuts in the Firefox Add-ons Manager)";

export const CAPTURE_SHORTCUT_UNSET_HINT = `No keyboard shortcut is set; you can add one in ${SHORTCUT_SETTINGS}.`;
const SHORTCUT_HINT_PREFIX = 'Shortcut: ';

export function renderCaptureShortcutHint(element: HTMLElement, shortcut: string | undefined): void {
  element.replaceChildren();
  if (shortcut === undefined) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  if (!shortcut) {
    element.textContent = CAPTURE_SHORTCUT_UNSET_HINT;
    return;
  }
  element.append(SHORTCUT_HINT_PREFIX);
  const key = element.ownerDocument.createElement('kbd');
  key.textContent = shortcut;
  element.append(key);
}
