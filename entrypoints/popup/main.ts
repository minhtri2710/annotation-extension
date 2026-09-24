import { browser } from 'wxt/browser';
import { CAPTURE_STATE_MESSAGE, CAPTURE_TOGGLE_MESSAGE, captureShortcutHint, lookupCaptureShortcut } from '../../lib/capture';
import { exportJson, importFileSizeError, importJson } from '../../lib/json-io';
import { listAllAnnotations, listAnnotations } from '../../lib/annotation-storage';
import { isRecord } from '../../lib/guards';
import { isEnabledForUrl } from '../../lib/options/policy';
import { readPolicy } from '../../lib/options/storage';
import { createBlobStore } from '../../lib/blob-store';
import { exportAllPages } from '../../lib/export/all-pages';
import { productionExportDelivery } from '../../lib/export/delivery';
import { PAGE_STYLES } from '../../lib/ui/page-styles';

const pageStyle = document.createElement('style');
pageStyle.textContent = PAGE_STYLES;
document.head.append(pageStyle);

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const exportMarkdownButton = document.querySelector<HTMLButtonElement>('#export-markdown');
const importButton = document.querySelector<HTMLButtonElement>('#import');
const importFile = document.querySelector<HTMLInputElement>('#import-file');
const status = document.querySelector<HTMLParagraphElement>('#status');
const pageCount = document.querySelector<HTMLParagraphElement>('#page-count');
const shortcutHint = document.querySelector<HTMLParagraphElement>('#shortcut-hint');

const blobStore = createBlobStore();
const UNAVAILABLE_STATUS = 'Annotations are not available on this page. If it was open before the extension loaded, reload it.';

void showTabState();
void showShortcutHint();

toggleButton?.addEventListener('click', async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active tab');
    await browser.tabs.sendMessage(tab.id, { type: CAPTURE_TOGGLE_MESSAGE });
  } catch {
    setStatus('Annotations are not available on this page.');
    return;
  }
  window.close();
});

exportButton?.addEventListener('click', async () => {
  setStatus(
    await exportJson({
      collect: listAllAnnotations,
      blobStore,
      download: downloadJson,
      copy: (json) => navigator.clipboard.writeText(json),
    }),
  );
});

exportMarkdownButton?.addEventListener('click', async () => {
  setStatus(
    await exportAllPages({
      collect: listAllAnnotations,
      readBlob: (key) => blobStore.get(key),
      delivery: productionExportDelivery,
    }),
  );
});

importButton?.addEventListener('click', () => importFile?.click());

importFile?.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;

  try {
    setStatus(importFileSizeError(file) ?? (await importJson(await file.text(), blobStore)));
  } catch {
    setStatus('Import failed: the file could not be read. Nothing was imported.');
  } finally {
    importFile.value = '';
  }
});

async function showTabState(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (tab?.id === undefined || !url || !['http:', 'https:', 'file:'].includes(new URL(url).protocol)) {
      setStatus("Annotations can't run on this page.");
      return;
    }
    void showPageCount(url);
    if (!isEnabledForUrl(url, await readPolicy())) {
      setStatus('Annotations are turned off for this site in Options.');
      return;
    }
    let reply: unknown;
    try {
      reply = await browser.tabs.sendMessage(tab.id, { type: CAPTURE_STATE_MESSAGE });
    } catch {
      reply = undefined;
    }
    if (!isRecord(reply) || typeof reply.active !== 'boolean') {
      setStatus(UNAVAILABLE_STATUS);
      return;
    }
    if (!toggleButton) return;
    toggleButton.textContent = reply.active ? 'Stop annotating' : 'Start annotating';
    toggleButton.disabled = false;
  } catch {
    setStatus(UNAVAILABLE_STATUS);
  }
}

async function showShortcutHint(): Promise<void> {
  let shortcut: string;
  try {
    shortcut = await lookupCaptureShortcut();
  } catch {
    return;
  }
  if (!shortcutHint) return;
  shortcutHint.textContent = captureShortcutHint(shortcut);
  shortcutHint.hidden = false;
  toggleButton?.setAttribute('aria-describedby', 'shortcut-hint');
}

async function showPageCount(url: string): Promise<void> {
  let count: number;
  try {
    count = (await listAnnotations(url)).length;
  } catch {
    return;
  }
  if (!pageCount) return;
  if (count === 0) pageCount.textContent = 'No annotations on this page yet.';
  else pageCount.textContent = `${count} annotation${count === 1 ? '' : 's'} on this page.`;
}

function downloadJson(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'annotations.json';
  link.click();
  URL.revokeObjectURL(url);
}

function setStatus(message: string): void {
  if (status) status.textContent = message;
}
