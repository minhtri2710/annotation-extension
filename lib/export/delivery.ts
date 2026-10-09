import { errorMessage } from '../guards';

export interface AnnotationClipboard {
  text: string;
  html: string;
}

export interface AnnotationExportDelivery {
  copy(pending: Promise<AnnotationClipboard>): Promise<void>;
  download(markdown: string, filename: string): void;
  downloadAsset(blob: Blob, filename: string): void;
}

export const productionExportDelivery: AnnotationExportDelivery = {
  async copy(pending) {
    if (typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function') {
      // The write starts before the payload settles, so it uses the user activation of the click that called copy.
      const html = pending.then(({ html }) => new Blob([html], { type: 'text/html' }));
      const text = pending.then(({ text }) => new Blob([text], { type: 'text/plain' }));
      // A write denied before it reads its entries would leave them unhandled; the failure is reported below.
      html.catch(() => undefined);
      text.catch(() => undefined);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
      } catch (writeError) {
        // Firefox reports a rejected payload as a generic DataError, so the payload's own error is reported when it failed.
        const source = await pending.then(() => undefined, (error: unknown) => ({ error }));
        if (source) throw source.error;
        throw writeError;
      }
      return;
    }
    copySelection((await pending).html);
  },
  download(markdown, filename) {
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
  },
  downloadAsset(blob, filename) {
    downloadBlob(blob, filename);
  },
};

function copySelection(html: string): void {
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
  buffer.style.cssText = 'position:fixed;left:-10000px;top:0;user-select:text';
  buffer.innerHTML = html;
  document.body.append(buffer);

  try {
    const range = document.createRange();
    range.selectNodeContents(buffer);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('copy')) {
      throw new Error('The browser declined to copy the selected annotations.');
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
