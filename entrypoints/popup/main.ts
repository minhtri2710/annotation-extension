import { browser } from 'wxt/browser';
import { CAPTURE_TOGGLE_MESSAGE } from '../../lib/capture';

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle');

toggleButton?.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  await browser.tabs.sendMessage(tab.id, { type: CAPTURE_TOGGLE_MESSAGE });
  window.close();
});
