import { errorMessage } from '../guards';

export interface AnnotationExportDelivery {
  copy(markdown: string): Promise<void>;
  download(markdown: string, filename: string): void;
  downloadAsset(blob: Blob, filename: string): void;
}

export const productionExportDelivery: AnnotationExportDelivery = {
  async copy(markdown) {
    const clipboard = navigator.clipboard;
    if (typeof clipboard?.writeText === 'function') {
      await clipboard.writeText(markdown);
      return;
    }
    copySelection(markdown);
  },
  download(markdown, filename) {
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
  },
  downloadAsset(blob, filename) {
    downloadBlob(blob, filename);
  },
};

function copySelection(text: string): void {
  const selection = document.getSelection();
  if (!selection || !document.body || typeof document.execCommand !== 'function') {
    throw new Error('The browser does not support the legacy copy command.');
  }
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  const activeElement = document.activeElement;
  const textControl = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
    ? activeElement
    : undefined;
  const textControlSelection = textControl?.selectionStart === null || textControl === undefined
    ? undefined
    : {
        start: textControl.selectionStart,
        end: textControl.selectionEnd,
        direction: textControl.selectionDirection ?? undefined,
      };
  const buffer = document.createElement('div');
  buffer.setAttribute('aria-hidden', 'true');
  buffer.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre;user-select:text';
  buffer.textContent = text;
  document.body.append(buffer);

  try {
    const range = document.createRange();
    range.selectNodeContents(buffer);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('copy')) {
      throw new Error('The browser declined to copy the selected Markdown.');
    }
  } finally {
    buffer.remove();
    selection.removeAllRanges();
    if (ranges.length === 1 && anchorNode && focusNode) {
      selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    } else {
      for (const range of ranges) selection.addRange(range);
    }
    if (textControl && textControlSelection) {
      if (document.activeElement !== textControl) textControl.focus();
      textControl.setSelectionRange(
        textControlSelection.start,
        textControlSelection.end,
        textControlSelection.direction,
      );
    }
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function clipboardFailure(copy: () => Promise<void>): Promise<string | undefined> {
  try {
    await copy();
    return undefined;
  } catch (error) {
    return `Downloaded; copy to clipboard failed: ${errorMessage(error)}`;
  }
}
