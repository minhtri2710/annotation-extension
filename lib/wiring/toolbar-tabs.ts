import { browser } from 'wxt/browser';
import { reply } from './background-messages';
import {
  isTabId,
  isToolbarGetMessage,
  isToolbarSetMessage,
  TOOLBAR_CHANGED_MESSAGE,
  type ToolbarChangedMessage,
} from './toolbar-tab-messages';

const TOOLBAR_TAB_KEY_PREFIX = 'ui:toolbar-tab:';
const toolbarTabKey = (tabId: number) => `${TOOLBAR_TAB_KEY_PREFIX}${tabId}`;

export function registerToolbarTabHandlers(): void {
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(toolbarTabKey(tabId));
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabIdOf = (named: number | undefined) => sender.tab?.id ?? named;

    if (isToolbarGetMessage(message)) {
      const tabId = tabIdOf(message.tabId);
      if (!isTabId(tabId)) return undefined;
      return reply(readTabState(tabId).then((on) => ({ on })), sendResponse);
    }

    if (isToolbarSetMessage(message)) {
      const tabId = tabIdOf(message.tabId);
      if (!isTabId(tabId)) return undefined;
      return reply(writeTabState(tabId, message.on).then(() => ({ on: message.on })), sendResponse);
    }

    return undefined;
  });
}

async function readTabState(tabId: number): Promise<boolean> {
  const key = toolbarTabKey(tabId);
  const stored = await browser.storage.session.get(key);
  return stored[key] === true;
}

async function writeTabState(tabId: number, on: boolean): Promise<void> {
  if (on) await browser.storage.session.set({ [toolbarTabKey(tabId)]: true });
  else await browser.storage.session.remove(toolbarTabKey(tabId));
  const changed: ToolbarChangedMessage = { type: TOOLBAR_CHANGED_MESSAGE, on };
  // A tab with no content script (a restricted page, one opened before install) has nothing to tell; its state is stored.
  browser.tabs.sendMessage(tabId, changed).catch(() => undefined);
}
