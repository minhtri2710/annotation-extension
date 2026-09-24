import { errorMessage } from '../guards';

export interface AnnotationExportDelivery {
  copy(markdown: string): Promise<void>;
  download(markdown: string, filename: string): void;
  downloadAsset(blob: Blob, filename: string): void;
}

export const productionExportDelivery: AnnotationExportDelivery = {
  async copy(markdown) {
    await navigator.clipboard.writeText(markdown);
  },
  download(markdown, filename) {
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
  },
  downloadAsset(blob, filename) {
    downloadBlob(blob, filename);
  },
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Runs a clipboard write after the download already happened; returns the status suffix when it fails. */
export async function clipboardFailure(copy: () => Promise<void>): Promise<string | undefined> {
  try {
    await copy();
    return undefined;
  } catch (error) {
    return `Downloaded; copy to clipboard failed: ${errorMessage(error)}`;
  }
}
