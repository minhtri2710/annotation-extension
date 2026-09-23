import { describe, expect, it } from 'vitest';
import {
  normalizeAttachmentName,
  validateAttachmentName,
} from './validation';

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
