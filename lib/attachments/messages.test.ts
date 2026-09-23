import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  isAttachmentAddMessage,
  isAttachmentDeleteMessage,
  sendAttachmentAdd,
  sendAttachmentDelete,
} from './messages';

const addMessage = {
  pageUrl: 'https://example.com/page',
  annotationId: 'annotation-1',
  name: 'photo.png',
  mimeType: 'image/png',
  base64: 'iVBORw0KGgo=',
};

const deleteMessage = {
  pageUrl: 'https://example.com/page',
  annotationId: 'annotation-1',
  attachmentId: 'attachment-1',
};

const metadata = { id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 8 };

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('isAttachmentAddMessage', () => {
  it('accepts the valid shape', () => {
    expect(isAttachmentAddMessage({ type: 'attachment.add', ...addMessage })).toBe(true);
  });

  it('rejects a wrong type', () => {
    expect(isAttachmentAddMessage({ type: 'attachment.delete', ...addMessage })).toBe(false);
  });

  it.each(['pageUrl', 'annotationId', 'name', 'mimeType', 'base64'] as const)(
    'rejects a non-string or missing %s',
    (field) => {
      expect(isAttachmentAddMessage({ type: 'attachment.add', ...addMessage, [field]: 1 })).toBe(false);
      const { [field]: _omitted, ...rest } = addMessage;
      expect(isAttachmentAddMessage({ type: 'attachment.add', ...rest })).toBe(false);
    },
  );

  it('rejects null, arrays and primitives', () => {
    const recordLikeArray = Object.assign([], { type: 'attachment.add', ...addMessage });
    for (const value of [null, undefined, 'attachment.add', recordLikeArray]) {
      expect(isAttachmentAddMessage(value)).toBe(false);
    }
  });
});

describe('isAttachmentDeleteMessage', () => {
  it('accepts the valid shape', () => {
    expect(isAttachmentDeleteMessage({ type: 'attachment.delete', ...deleteMessage })).toBe(true);
  });

  it('rejects a wrong type', () => {
    expect(isAttachmentDeleteMessage({ type: 'attachment.add', ...deleteMessage })).toBe(false);
  });

  it.each(['pageUrl', 'annotationId', 'attachmentId'] as const)('rejects a non-string or missing %s', (field) => {
    expect(isAttachmentDeleteMessage({ type: 'attachment.delete', ...deleteMessage, [field]: null })).toBe(false);
    const { [field]: _omitted, ...rest } = deleteMessage;
    expect(isAttachmentDeleteMessage({ type: 'attachment.delete', ...rest })).toBe(false);
  });

  it('rejects null, arrays and primitives', () => {
    const recordLikeArray = Object.assign([], { type: 'attachment.delete', ...deleteMessage });
    for (const value of [null, undefined, 'attachment.delete', recordLikeArray]) {
      expect(isAttachmentDeleteMessage(value)).toBe(false);
    }
  });
});

describe('sendAttachmentAdd', () => {
  it('sends the exact add message and returns the validated metadata', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(metadata as never);

    await expect(sendAttachmentAdd(addMessage)).resolves.toEqual(metadata);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual([{ type: 'attachment.add', ...addMessage }]);
  });

  it('rejects with the error text of an error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'quota exceeded' } as never);
    await expect(sendAttachmentAdd(addMessage)).rejects.toThrow('quota exceeded');
  });

  it('rejects a response that is not attachment metadata', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ...metadata, byteLength: 0 } as never);
    await expect(sendAttachmentAdd(addMessage)).rejects.toThrow('Invalid attachment response');
  });
});

describe('sendAttachmentDelete', () => {
  it('sends the exact delete message and returns the boolean result', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(false as never);

    await expect(sendAttachmentDelete(deleteMessage)).resolves.toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual([{ type: 'attachment.delete', ...deleteMessage }]);
  });

  it('rejects with the error text of an error response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'not found' } as never);
    await expect(sendAttachmentDelete(deleteMessage)).rejects.toThrow('not found');
  });

  it('rejects a non-boolean response', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue('true' as never);
    await expect(sendAttachmentDelete(deleteMessage)).rejects.toThrow('Invalid attachment deletion response');
  });
});
