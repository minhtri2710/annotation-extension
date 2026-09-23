import { browser } from 'wxt/browser';
import { isAnnotationErrorResponse, isAttachmentMetadata, type AnnotationErrorResponse } from '../annotation-messages';
import type { AttachmentMetadata } from '../annotation';
import { isRecord } from '../guards';

export type AttachmentAddMessage = {
  type: 'attachment.add';
  pageUrl: string;
  annotationId: string;
  name: string;
  mimeType: string;
  base64: string;
};

export type AttachmentDeleteMessage = {
  type: 'attachment.delete';
  pageUrl: string;
  annotationId: string;
  attachmentId: string;
};

export function isAttachmentAddMessage(value: unknown): value is AttachmentAddMessage {
  if (
    !isRecord(value) ||
    value.type !== 'attachment.add' ||
    typeof value.pageUrl !== 'string' ||
    typeof value.annotationId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    typeof value.base64 !== 'string'
  ) {
    return false;
  }
  return true;
}

export function isAttachmentDeleteMessage(value: unknown): value is AttachmentDeleteMessage {
  return (
    isRecord(value) &&
    value.type === 'attachment.delete' &&
    typeof value.pageUrl === 'string' &&
    typeof value.annotationId === 'string' &&
    typeof value.attachmentId === 'string'
  );
}

export function sendAttachmentAdd(
  message: Omit<AttachmentAddMessage, 'type'>,
): Promise<AttachmentMetadata> {
  return browser.runtime
    .sendMessage<AttachmentAddMessage, AttachmentMetadata | AnnotationErrorResponse>({
      type: 'attachment.add',
      ...message,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      if (!isAttachmentMetadata(response)) throw new Error('Invalid attachment response');
      return response;
    });
}

export function sendAttachmentDelete(
  message: Omit<AttachmentDeleteMessage, 'type'>,
): Promise<boolean> {
  return browser.runtime
    .sendMessage<AttachmentDeleteMessage, boolean | AnnotationErrorResponse>({
      type: 'attachment.delete',
      ...message,
    })
    .then((response) => {
      if (isAnnotationErrorResponse(response)) throw new Error(response.error);
      if (typeof response !== 'boolean') throw new Error('Invalid attachment deletion response');
      return response;
    });
}
