import { browser } from 'wxt/browser';
import { CAPTURE_TOGGLE_MESSAGE } from '../../lib/capture';
import { collectAllAnnotations, importAll, parseImport, serialize } from '../../lib/json-io';
import { createBlobStore } from '../../lib/blob-store';
import { PAGE_STYLES } from '../../lib/ui/page-styles';

const pageStyle = document.createElement('style');
pageStyle.textContent = PAGE_STYLES;
document.head.append(pageStyle);

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const importButton = document.querySelector<HTMLButtonElement>('#import');
const importFile = document.querySelector<HTMLInputElement>('#import-file');
const status = document.querySelector<HTMLParagraphElement>('#status');

const blobStore = createBlobStore();

toggleButton?.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  await browser.tabs.sendMessage(tab.id, { type: CAPTURE_TOGGLE_MESSAGE });
  window.close();
});

exportButton?.addEventListener('click', async () => {
  const json = await serialize(await collectAllAnnotations(), blobStore);
  await navigator.clipboard.writeText(json);
  downloadJson(json);
  setStatus('Annotations exported.');
});

importButton?.addEventListener('click', () => importFile?.click());

importFile?.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;

  try {
    const plan = parseImport(await file.text());
    await importAll(plan, blobStore);
    setStatus(`Imported ${plan.length} annotation${plan.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Import failed.');
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
