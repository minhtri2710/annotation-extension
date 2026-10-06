import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { productionExportDelivery } from './delivery';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

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
      copyPromise = productionExportDelivery.copy('# Notes').then(() => undefined, (error) => error);
    });
    let selectedMarkdown = '';
    const execCommand = vi.spyOn(document, 'execCommand').mockImplementation((command) => {
      expect(command).toBe('copy');
      const temporary = document.querySelector('[aria-hidden="true"]');
      expect(temporary).not.toBeNull();
      expect(temporary?.textContent).toBe('# Notes');
      selectedMarkdown = document.getSelection()?.toString() ?? '';
      return true;
    });

    try {
      await userEvent.click(host);
      expect(await copyPromise).toBeUndefined();
      expect(execCommand).toHaveBeenCalledTimes(1);
      expect(selectedMarkdown).toBe('# Notes');
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
      copyPromise = productionExportDelivery.copy('# Notes').then(() => undefined, (error) => error);
    });
    const execCommand = vi.spyOn(document, 'execCommand').mockImplementation(() => {
      expect(document.getSelection()?.toString()).toBe('# Notes');
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
      copyPromise = productionExportDelivery.copy('# Notes').then(() => undefined, (error) => error);
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
      expect(selectedText).toBe('# Notes');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      document.removeEventListener('copy', copied, true);
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('rejects a native write failure without trying the legacy copy path', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn(() => Promise.reject(new Error('permission denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    try {
      await expect(productionExportDelivery.copy('# Notes')).rejects.toThrow('permission denied');
      expect(writeText).toHaveBeenCalledWith('# Notes');
      expect(execCommand).not.toHaveBeenCalled();
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
      await expect(productionExportDelivery.copy('# Notes')).rejects.toThrow('browser declined to copy');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
