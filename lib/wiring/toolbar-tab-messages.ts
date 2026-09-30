import { sendBackgroundRequest } from '../annotation-messages';
import { isRecord } from '../guards';

export const TOOLBAR_GET_MESSAGE = 'toolbar.get' as const;
export const TOOLBAR_SET_MESSAGE = 'toolbar.set' as const;
export const TOOLBAR_CHANGED_MESSAGE = 'toolbar.changed' as const;

/** The tab is the sender's for a content script; the popup names the tab it reads. */
export interface ToolbarGetMessage {
  type: typeof TOOLBAR_GET_MESSAGE;
  tabId?: number;
}

/** The tab is the sender's for a content script; the popup names the tab it sets. */
export interface ToolbarSetMessage {
  type: typeof TOOLBAR_SET_MESSAGE;
  on: boolean;
  tabId?: number;
}

/** Sent by the background to a tab's content script after its state changed. */
export interface ToolbarChangedMessage {
  type: typeof TOOLBAR_CHANGED_MESSAGE;
  on: boolean;
}

export function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const hasOptionalTabId = (value: Record<string, unknown>) => value.tabId === undefined || isTabId(value.tabId);

export function isToolbarGetMessage(value: unknown): value is ToolbarGetMessage {
  return isRecord(value) && value.type === TOOLBAR_GET_MESSAGE && hasOptionalTabId(value);
}

export function isToolbarSetMessage(value: unknown): value is ToolbarSetMessage {
  return isRecord(value) && value.type === TOOLBAR_SET_MESSAGE && typeof value.on === 'boolean' && hasOptionalTabId(value);
}

export function isToolbarChangedMessage(value: unknown): value is ToolbarChangedMessage {
  return isRecord(value) && value.type === TOOLBAR_CHANGED_MESSAGE && typeof value.on === 'boolean';
}

const isToolbarState = (value: unknown): value is { on: boolean } => isRecord(value) && typeof value.on === 'boolean';
const INVALID_STATE = 'Invalid toolbar state response';

/** Whether the toolbar is on in a tab: the sending tab when called from a content script, the named tab from the popup. */
export async function readToolbarTab(tabId?: number): Promise<boolean> {
  const message: ToolbarGetMessage = tabId === undefined ? { type: TOOLBAR_GET_MESSAGE } : { type: TOOLBAR_GET_MESSAGE, tabId };
  return (await sendBackgroundRequest(message, isToolbarState, INVALID_STATE)).on;
}

/** Turns the toolbar on or off in a tab, with the same tab rule as readToolbarTab. */
export async function setToolbarTab(on: boolean, tabId?: number): Promise<boolean> {
  const message: ToolbarSetMessage = tabId === undefined ? { type: TOOLBAR_SET_MESSAGE, on } : { type: TOOLBAR_SET_MESSAGE, on, tabId };
  return (await sendBackgroundRequest(message, isToolbarState, INVALID_STATE)).on;
}
