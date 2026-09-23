export const SUPPORTED_IMAGE_MIME_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_NAME_LENGTH = 120;

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** The one image rule for every blob write and the import: a supported type, a bounded size, and bytes that are that type. */
export async function validateImageBlob(blob: Blob, mimeType = blob.type): Promise<void> {
  if (!isSupportedImageMimeType(mimeType)) throw new Error(`Unsupported image mime type: ${mimeType}.`);
  if (blob.size === 0) throw new Error('Image must not be empty.');
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 2 MB limit.');
  if ((await imageTypeOf(blob)) !== mimeType) throw new Error(`Image bytes are not ${mimeType}.`);
}

/** The supported image type the bytes are, by their signature; undefined for anything else. */
export async function imageTypeOf(blob: Blob): Promise<SupportedImageMimeType | undefined> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const startsWith = (signature: string, offset = 0) =>
    [...signature].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (startsWith('RIFF') && startsWith('WEBP', 8)) return 'image/webp';
  return undefined;
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

export function normalizeAttachmentName(fileName: string, mimeType: SupportedImageMimeType): string {
  let name = fileName.trim();
  if (!name) name = `image.${imageExtension(mimeType)}`;
  if (name.length > MAX_ATTACHMENT_NAME_LENGTH) {
    const extension = /\.[^./\\]+$/.exec(name)?.[0];
    if (extension && extension.length < MAX_ATTACHMENT_NAME_LENGTH) {
      name = `${name.slice(0, MAX_ATTACHMENT_NAME_LENGTH - extension.length)}${extension}`;
    } else {
      name = name.slice(0, MAX_ATTACHMENT_NAME_LENGTH);
    }
  }
  return validateAttachmentName(name);
}

function imageExtension(mimeType: SupportedImageMimeType): string {
  switch (mimeType) {
    case 'image/webp': return 'webp';
    case 'image/jpeg': return 'jpeg';
    case 'image/png': return 'png';
  }
}
