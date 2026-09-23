import { describe, expect, it } from 'vitest';
import {
  imageTypeOf,
  normalizeAttachmentName,
  validateAttachmentName,
  validateImageBlob,
} from './validation';

const bytes = (text: string, type = '') =>
  new Blob([Uint8Array.from(text, (character) => character.charCodeAt(0))], { type });

describe('normalizeAttachmentName', () => {
  it('trims a usable file name', () => {
    expect(normalizeAttachmentName('  photo.png  ', 'image/png')).toBe('photo.png');
  });

  it('creates a MIME-derived name for an empty file name', () => {
    expect(normalizeAttachmentName('   ', 'image/webp')).toBe('image.webp');
    expect(normalizeAttachmentName('', 'image/jpeg')).toBe('image.jpeg');
    expect(normalizeAttachmentName('', 'image/png')).toBe('image.png');
  });

  it('truncates long names while preserving their final extension', () => {
    const name = normalizeAttachmentName(`${'a'.repeat(130)}.png`, 'image/png');
    expect(name).toHaveLength(120);
    expect(name).toMatch(/\.png$/);
    expect(() => validateAttachmentName(name)).not.toThrow();
  });

  it('truncates long names without an extension to the validation limit', () => {
    const name = normalizeAttachmentName('a'.repeat(130), 'image/png');
    expect(name).toHaveLength(120);
    expect(() => validateAttachmentName(name)).not.toThrow();
  });
});

describe('imageTypeOf', () => {
  it('names the supported type the bytes are, whatever the Blob declares', async () => {
    await expect(imageTypeOf(bytes('\x89PNG\r\n\x1a\nrest', 'image/jpeg'))).resolves.toBe('image/png');
    await expect(imageTypeOf(bytes('\xff\xd8\xff\xe0rest', 'image/png'))).resolves.toBe('image/jpeg');
    await expect(imageTypeOf(bytes('RIFF\0\0\0\0WEBPrest'))).resolves.toBe('image/webp');
  });

  it('returns undefined for bytes of no supported type', async () => {
    await expect(imageTypeOf(bytes('<svg onload=alert(1)>', 'image/png'))).resolves.toBeUndefined();
    await expect(imageTypeOf(bytes('RIFF\0\0\0\0WAVE'))).resolves.toBeUndefined();
    await expect(imageTypeOf(bytes('\x89PN'))).resolves.toBeUndefined();
    await expect(imageTypeOf(bytes(''))).resolves.toBeUndefined();
  });
});

describe('validateImageBlob', () => {
  it('refuses bytes that are not the declared type', async () => {
    await expect(validateImageBlob(bytes('\xff\xd8\xff\xe0', 'image/png'))).rejects.toThrow('Image bytes are not image/png.');
    await expect(validateImageBlob(bytes('\xff\xd8\xff\xe0'), 'image/jpeg')).resolves.toBeUndefined();
  });
});
