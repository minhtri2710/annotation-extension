export interface AnnotationExportDelivery {
  copy(markdown: string): Promise<void>;
  download(markdown: string, filename: string): void;
}

export const productionExportDelivery: AnnotationExportDelivery = {
  async copy(markdown) {
    await navigator.clipboard.writeText(markdown);
  },
  download(markdown, filename) {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};
