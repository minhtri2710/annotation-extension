import { describe, expect, it } from 'vitest';
import { base64ToBlob, blobToBase64 } from './base64';

describe('base64', () => {
  it('round-trips all 256 byte values and keeps the given mime type', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const blob = base64ToBlob(await blobToBase64(new Blob([bytes])), 'image/png');
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('throws on input that is not base64', () => {
    expect(() => base64ToBlob('not base64!', 'image/png')).toThrow();
  });
});
