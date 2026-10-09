import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { MAX_IMAGE_BYTES } from '../attachments/validation';
import { formatHtml } from './html';

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  const pageUrl = overrides.pageUrl ?? 'https://example.com/article';
  return {
    id: 'one',
    pageUrl,
    note: 'Inspect this button',
    selector: '#submit-button',
    elementContext: {
      selector: '#submit-button',
      tagName: 'BUTTON',
      id: 'submit-button',
      classList: [],
      text: '',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      url: pageUrl,
      viewport: { width: 1280, height: 720 },
      sourcePath: null,
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

const webpMetadata = { mimeType: 'image/webp', width: 1, height: 1, byteLength: 3 };
const webp = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

describe('formatHtml', () => {
  it('embeds the screenshot and then the attachments as data URIs in annotation order', async () => {
    const annotations = [
      annotation({
        screenshot: webpMetadata,
        attachments: [{ id: 'att-a', name: 'a.png', mimeType: 'image/png', byteLength: 5 }],
      }),
    ];
    const html = await formatHtml(annotations, async (key) => (key === 'screenshot:one' ? webp : png));

    expect(html).toContain(`src="data:image/webp;base64,${btoa('\x01\x02\x03')}"`);
    expect(html).toContain(`src="data:image/png;base64,${btoa('\x89PNG')}"`);
    expect(html.indexOf('data:image/webp')).toBeLessThan(html.indexOf('data:image/png'));
  });

  it('escapes untrusted note, selector and page text so no markup from the page or the note becomes live', async () => {
    const html = await formatHtml(
      [annotation({ note: '<img src=x onerror=alert(1)>', selector: '"><script>x</script>', pageUrl: 'https://example.com/a?x=1&y=<b>' })],
      async () => undefined,
    );

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('https://example.com/a?x=1&amp;y=&lt;b&gt;');
  });

  it('references embedded data only, never a remote URL', async () => {
    const html = await formatHtml(
      [annotation({ screenshot: webpMetadata })],
      async () => webp,
    );

    expect(html).toContain('src="data:image/webp;base64,');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*"(?:https?:|\/\/)/);
  });

  it('refuses to copy when a declared screenshot blob is missing instead of copying without it', async () => {
    await expect(
      formatHtml([annotation({ note: 'Still here', screenshot: webpMetadata })], async () => undefined),
    ).rejects.toThrow('The image "Annotation screenshot" is missing and cannot be copied.');
  });

  it('refuses to copy when a declared attachment blob is missing', async () => {
    await expect(
      formatHtml(
        [annotation({ attachments: [{ id: 'att-a', name: 'a.png', mimeType: 'image/png', byteLength: 1 }] })],
        async () => undefined,
      ),
    ).rejects.toThrow('The image "a.png" is missing and cannot be copied.');
  });

  it('refuses a stored image that is not a supported type', async () => {
    await expect(
      formatHtml([annotation({ screenshot: webpMetadata })], async () => new Blob(['GIF89a'], { type: 'image/gif' })),
    ).rejects.toThrow();
  });

  it('refuses a stored image over the image byte cap', async () => {
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' });

    await expect(formatHtml([annotation({ screenshot: webpMetadata })], async () => oversized)).rejects.toThrow();
  });

  it('passes a blob read failure through instead of copying without the image', async () => {
    await expect(
      formatHtml([annotation({ screenshot: webpMetadata })], async () => {
        throw new Error('Blob transaction failed');
      }),
    ).rejects.toThrow('Blob transaction failed');
  });
});
