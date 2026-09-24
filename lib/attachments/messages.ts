import { isAttachmentMetadata, sendBackgroundRequest } from '../annotation-messages';
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
  return sendBackgroundRequest<AttachmentAddMessage, AttachmentMetadata>(
    { type: 'attachment.add', ...message },
    isAttachmentMetadata,
    'Invalid attachment response',
  );
}

export function sendAttachmentDelete(
  message: Omit<AttachmentDeleteMessage, 'type'>,
): Promise<boolean> {
  return sendBackgroundRequest<AttachmentDeleteMessage, boolean>(
    { type: 'attachment.delete', ...message },
    (response): response is boolean => typeof response === 'boolean',
    'Invalid attachment deletion response',
  );
}
