export interface AnnotationExportDelivery {
  copy(markdown: string): Promise<void>;
  download(markdown: string, filename: string): void;
  downloadAsset(dataUrl: string, filename: string): void;
}

export const productionExportDelivery: AnnotationExportDelivery = {
  async copy(markdown) {
    await navigator.clipboard.writeText(markdown);
  },
  download(markdown, filename) {
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
  },
  downloadAsset(dataUrl, filename) {
    const [header, base64] = dataUrl.split(',', 2);
    if (!header?.includes(';base64') || !base64) return;

    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const mimeType = header.slice('data:'.length, header.indexOf(';')) || 'application/octet-stream';
    downloadBlob(new Blob([bytes], { type: mimeType }), filename);
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
