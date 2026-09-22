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
