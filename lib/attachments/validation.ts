export const SUPPORTED_IMAGE_MIME_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_NAME_LENGTH = 120;

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function validateImageBlob(blob: Blob, mimeType = blob.type): void {
  if (!isSupportedImageMimeType(mimeType)) throw new Error(`Unsupported image mime type: ${mimeType}.`);
  if (blob.size === 0) throw new Error('Image must not be empty.');
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 2 MB limit.');
}

export function validateAttachmentName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('Attachment name must not be empty.');
  if (name.length > MAX_ATTACHMENT_NAME_LENGTH) {
    throw new Error('Attachment name exceeds the 120 character limit.');
  }
  if (name !== value) throw new Error('Attachment name must be trimmed.');
  return name;
}
