import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { registerBackgroundMessageHandlers } from '../lib/wiring/background-messages';
import { CAPTURE_TOGGLE_MESSAGE } from '../lib/capture';

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== CAPTURE_TOGGLE_MESSAGE) return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    await browser.tabs.sendMessage(tab.id, { type: CAPTURE_TOGGLE_MESSAGE });
  });

  registerBackgroundMessageHandlers();
});
