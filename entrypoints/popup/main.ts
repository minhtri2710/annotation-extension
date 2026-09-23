import { browser } from 'wxt/browser';
import { CAPTURE_TOGGLE_MESSAGE } from '../../lib/capture';
import { collectAllAnnotations, exportJson, importJson } from '../../lib/json-io';
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

const blobStore = createBlobStore();

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
      collect: collectAllAnnotations,
      blobStore,
      deliver: async (json) => {
        await navigator.clipboard.writeText(json);
        downloadJson(json);
      },
    }),
  );
});

exportMarkdownButton?.addEventListener('click', async () => {
  setStatus(
    await exportAllPages({
      collect: collectAllAnnotations,
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
    setStatus(await importJson(await file.text(), blobStore));
  } catch {
    setStatus('Import failed: the file could not be read. Nothing was imported.');
  } finally {
    importFile.value = '';
  }
});

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
