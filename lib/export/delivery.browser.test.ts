import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { productionExportDelivery, type AnnotationClipboard } from './delivery';

const content: AnnotationClipboard = { text: '# Notes', html: '<h2>Notes</h2><img alt="shot" src="data:image/png;base64,AAAA">' };
// A valid 1x1 PNG, so the embedded image decodes in a real browser.
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function countUnhandledRejections() {
  let count = 0;
  const onUnhandled = () => {
    count += 1;
  };
  window.addEventListener('unhandledrejection', onUnhandled);
  return {
    count: () => count,
    stop: () => window.removeEventListener('unhandledrejection', onUnhandled),
  };
}

describe('productionExportDelivery.copy (real browser)', () => {
  it('invokes the legacy copy command for selected Markdown and restores closed-shadow focus and selection', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:8px;top:8px;width:140px;height:40px';
    const shadow = host.attachShadow({ mode: 'closed' });
    const button = document.createElement('button');
    button.style.cssText = 'width:100%;height:100%';
    button.textContent = 'Copy Markdown';
    shadow.append(button);
    const text = document.createElement('p');
    text.textContent = 'preserve this selection';
    document.body.append(host, text);
    button.focus();
    const range = document.createRange();
    range.setStart(text.firstChild!, 0);
    range.setEnd(text.firstChild!, text.textContent.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    let copyPromise: Promise<void> | undefined;
    button.addEventListener('click', () => {
      copyPromise = productionExportDelivery.copy(Promise.resolve(content)).then(() => undefined, (error) => error);
    });
    let selectedMarkdown = '';
    const execCommand = vi.spyOn(document, 'execCommand').mockImplementation((command) => {
      expect(command).toBe('copy');
      const temporary = document.querySelector('[aria-hidden="true"]');
      expect(temporary).not.toBeNull();
      expect(temporary?.textContent).toBe('Notes');
      expect(temporary?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      selectedMarkdown = document.getSelection()?.toString() ?? '';
      return true;
    });

    try {
      await userEvent.click(host);
      expect(await copyPromise).toBeUndefined();
      expect(execCommand).toHaveBeenCalledTimes(1);
      expect(selectedMarkdown).toContain('Notes');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(button);
      expect(document.getSelection()?.anchorNode).toBe(text.firstChild);
      expect(document.getSelection()?.anchorOffset).toBe(0);
      expect(document.getSelection()?.focusNode).toBe(text.firstChild);
      expect(document.getSelection()?.focusOffset).toBe(text.textContent.length);

      execCommand.mockReturnValue(false);
      await userEvent.click(host);
      expect(await copyPromise).toBeInstanceOf(Error);
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(button);
      expect(document.getSelection()?.anchorNode).toBe(text.firstChild);
      expect(document.getSelection()?.anchorOffset).toBe(0);
      expect(document.getSelection()?.focusNode).toBe(text.firstChild);
      expect(document.getSelection()?.focusOffset).toBe(text.textContent.length);

      execCommand.mockImplementation(() => {
        throw new Error('copy command threw');
      });
      await userEvent.click(host);
      const commandError = await copyPromise;
      expect(commandError).toEqual(new Error('copy command threw'));
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(button);
      expect(document.getSelection()?.anchorNode).toBe(text.firstChild);
      expect(document.getSelection()?.anchorOffset).toBe(0);
      expect(document.getSelection()?.focusNode).toBe(text.firstChild);
      expect(document.getSelection()?.focusOffset).toBe(text.textContent.length);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('preserves an active input selection when the fallback runs', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const input = document.createElement('input');
    input.value = 'preserve this input selection';
    document.body.append(input);
    let copyPromise: Promise<void | unknown> | undefined;
    input.addEventListener('click', () => {
      input.setSelectionRange(4, 12, 'backward');
      copyPromise = productionExportDelivery.copy(Promise.resolve(content)).then(() => undefined, (error) => error);
    });
    const execCommand = vi.spyOn(document, 'execCommand').mockImplementation(() => {
      expect(document.getSelection()?.toString()).toContain('Notes');
      return true;
    });

    try {
      await userEvent.click(input);
      expect(await copyPromise).toBeUndefined();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(4);
      expect(input.selectionEnd).toBe(12);
      expect(input.selectionDirection).toBe('backward');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('runs the real browser copy command when the Clipboard API is absent', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const button = document.createElement('button');
    button.style.cssText = 'position:fixed;left:8px;top:8px;width:140px;height:40px';
    button.textContent = 'Copy Markdown';
    document.body.append(button);
    let copyPromise: Promise<void | unknown> | undefined;
    button.addEventListener('click', () => {
      copyPromise = productionExportDelivery.copy(Promise.resolve(content)).then(() => undefined, (error) => error);
    });
    let copyEvents = 0;
    let selectedText = '';
    const copied = () => {
      copyEvents += 1;
      selectedText = document.getSelection()?.toString() ?? '';
    };
    document.addEventListener('copy', copied, true);

    try {
      await userEvent.click(button);
      expect(await copyPromise).toBeUndefined();
      expect(copyEvents).toBe(1);
      expect(selectedText).toContain('Notes');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      document.removeEventListener('copy', copied, true);
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies a real embedded image through the legacy copy event', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const pngSrc = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    const button = document.createElement('button');
    button.style.cssText = 'position:fixed;left:8px;top:8px;width:140px;height:40px';
    button.textContent = 'Copy Markdown';
    document.body.append(button);
    let copyPromise: Promise<void | unknown> | undefined;
    button.addEventListener('click', () => {
      copyPromise = productionExportDelivery.copy(Promise.resolve({ text: '# Notes', html: `<h2>Notes</h2><img alt="shot" src="${pngSrc}">` }))
        .then(() => undefined, (error) => error);
    });
    let copiedHtml = '';
    const copied = () => {
      const holder = document.createElement('div');
      holder.append(document.getSelection()!.getRangeAt(0).cloneContents());
      copiedHtml = holder.innerHTML;
    };
    document.addEventListener('copy', copied, true);

    try {
      await userEvent.click(button);
      expect(await copyPromise).toBeUndefined();
      expect(copiedHtml).toContain(`<img alt="shot" src="${pngSrc}">`);
      const decoded = new Image();
      decoded.src = pngSrc;
      await decoded.decode();
      expect(decoded.naturalWidth).toBe(1);
      expect(decoded.naturalHeight).toBe(1);
    } finally {
      document.removeEventListener('copy', copied, true);
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('starts the native write before a delayed payload settles, then writes the rich entries', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const write = vi.fn(async (_items: ClipboardItem[]) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    const button = document.createElement('button');
    button.style.cssText = 'position:fixed;left:8px;top:8px;width:140px;height:40px';
    button.textContent = 'Copy Markdown';
    document.body.append(button);
    let payloadSettled = false;
    let writeStartedBeforePayload = false;
    let copyPromise: Promise<void | unknown> | undefined;
    button.addEventListener('click', () => {
      const pending = new Promise<typeof content>((resolve) => {
        setTimeout(() => {
          payloadSettled = true;
          resolve(content);
        }, 100);
      });
      copyPromise = productionExportDelivery.copy(pending).then(() => undefined, (error) => error);
      writeStartedBeforePayload = write.mock.calls.length === 1 && !payloadSettled;
    });

    try {
      await userEvent.click(button);
      expect(writeStartedBeforePayload).toBe(true);
      expect(await copyPromise).toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);
      const [items] = write.mock.calls[0]!;
      expect(items).toHaveLength(1);
      expect(items[0]!.types.slice().sort()).toEqual(['text/html', 'text/plain']);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('reports the payload error when a rejected payload fails the native write, with no unhandled rejection', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const missing = 'The image "Annotation screenshot" is missing and cannot be copied.';
    // Firefox raises a generic DataError for a rejected entry, so the payload's own error must be the one reported.
    const write = vi.fn(async (_items: ClipboardItem[]) => {
      throw new DOMException('Data provided to an operation does not meet requirements', 'DataError');
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    const unhandled = countUnhandledRejections();

    try {
      await expect(productionExportDelivery.copy(Promise.reject(new Error(missing)))).rejects.toThrow(missing);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled.count()).toBe(0);
    } finally {
      unhandled.stop();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('rejects a native write failure without trying the legacy copy path', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const write = vi.fn(() => Promise.reject(new Error('permission denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    try {
      await expect(productionExportDelivery.copy(Promise.resolve(content))).rejects.toThrow('permission denied');
      expect(write).toHaveBeenCalledTimes(1);
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('reports a rejected payload on the legacy path without selecting anything', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const missing = 'The image "Annotation screenshot" is missing and cannot be copied.';
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    try {
      await expect(productionExportDelivery.copy(Promise.reject(new Error(missing)))).rejects.toThrow(missing);
      expect(execCommand).not.toHaveBeenCalled();
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('rejects a declined legacy copy and removes the temporary selection node', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(false);

    try {
      await expect(productionExportDelivery.copy(Promise.resolve(content))).rejects.toThrow('browser declined to copy');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
