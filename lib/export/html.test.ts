import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { MAX_IMAGE_BYTES } from '../attachments/validation';
import { formatPageHtml } from './html';

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

const pageUrl = 'https://example.com/article';
const webpMetadata = { mimeType: 'image/webp', width: 1, height: 1, byteLength: 3 };
const webp = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

describe('formatPageHtml', () => {
  it('embeds the screenshot and then the attachments as data URIs in annotation order', async () => {
    const annotations = [
      annotation({
        screenshot: webpMetadata,
        attachments: [{ id: 'att-a', name: 'a.png', mimeType: 'image/png', byteLength: 5 }],
      }),
    ];
    const html = await formatPageHtml(pageUrl, annotations, async (key) => (key === 'screenshot:one' ? webp : png));

    expect(html).toContain(`src="data:image/webp;base64,${btoa('\x01\x02\x03')}"`);
    expect(html).toContain(`src="data:image/png;base64,${btoa('\x89PNG')}"`);
    expect(html.indexOf('data:image/webp')).toBeLessThan(html.indexOf('data:image/png'));
  });

  it('escapes untrusted note, selector and page text so no markup from the page or the note becomes live', async () => {
    const html = await formatPageHtml(
      'https://example.com/a?x=1&y=<b>',
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
    const html = await formatPageHtml(pageUrl,
      [annotation({ screenshot: webpMetadata })],
      async () => webp,
    );

    expect(html).toContain('src="data:image/webp;base64,');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*"(?:https?:|\/\/)/);
  });

  it('refuses to copy when a declared screenshot blob is missing instead of copying without it', async () => {
    await expect(
      formatPageHtml(pageUrl, [annotation({ note: 'Still here', screenshot: webpMetadata })], async () => undefined),
    ).rejects.toThrow('The image "Annotation screenshot" is missing and cannot be copied.');
  });

  it('refuses to copy when a declared attachment blob is missing', async () => {
    await expect(
      formatPageHtml(pageUrl,
        [annotation({ attachments: [{ id: 'att-a', name: 'a.png', mimeType: 'image/png', byteLength: 1 }] })],
        async () => undefined,
      ),
    ).rejects.toThrow('The image "a.png" is missing and cannot be copied.');
  });

  it('refuses a stored image that is not a supported type', async () => {
    await expect(
      formatPageHtml(pageUrl, [annotation({ screenshot: webpMetadata })], async () => new Blob(['GIF89a'], { type: 'image/gif' })),
    ).rejects.toThrow();
  });

  it('refuses a stored image over the image byte cap', async () => {
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' });

    await expect(formatPageHtml(pageUrl, [annotation({ screenshot: webpMetadata })], async () => oversized)).rejects.toThrow();
  });

  it('passes a blob read failure through instead of copying without the image', async () => {
    await expect(
      formatPageHtml(pageUrl, [annotation({ screenshot: webpMetadata })], async () => {
        throw new Error('Blob transaction failed');
      }),
    ).rejects.toThrow('Blob transaction failed');
  });

  it('carries every field the Markdown carries: source, reproduction, CSS tweaks, multi-line note and status', async () => {
    const html = await formatPageHtml(pageUrl,
      [
        annotation({
          note: 'First line\n  indented second line',
          status: 'resolved',
          elementContext: {
            ...annotation().elementContext,
            text: 'Save',
            sourcePath: { fileName: 'src/Button.tsx', lineNumber: 42 },
          },
          repro: { steps: ['Open the menu', 'Press Save'], expected: 'menu opens', actual: 'menu stays closed' },
          cssEdits: [
            { property: 'color', value: '#fff', original: '#000' },
            { property: 'padding', value: '8px', original: '4px' },
          ],
        }),
      ],
      async () => undefined,
    );

    expect(html).toContain('Status: resolved');
    expect(html).toContain('<pre>First line\n  indented second line</pre>');
    expect(html).toContain('src/Button.tsx:42');
    expect(html).toContain('Reproduction');
    expect(html).toContain('1. Open the menu');
    expect(html).toContain('2. Press Save');
    expect(html).toContain('Expected: menu opens');
    expect(html).toContain('Actual: menu stays closed');
    expect(html).toContain('CSS tweaks');
    expect(html).toContain('color: #000 -&gt; #fff');
    expect(html).toContain('padding: 4px -&gt; 8px');
  });

  it('escapes reproduction, CSS and source text', async () => {
    const html = await formatPageHtml(pageUrl,
      [
        annotation({
          elementContext: {
            ...annotation().elementContext,
            sourcePath: { fileName: '<i>Button.tsx</i>' },
          },
          repro: { steps: ['<b>click</b>'], expected: '<s>a</s>', actual: '<u>b</u>' },
          cssEdits: [{ property: 'content', value: '"<x>"', original: '<y>' }],
        }),
      ],
      async () => undefined,
    );

    expect(html).not.toMatch(/<(b|s|u|i|x|y)>/);
    expect(html).toContain('&lt;b&gt;click&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;Button.tsx&lt;/i&gt;');
    expect(html).toContain('content: &lt;y&gt; -&gt; &quot;&lt;x&gt;&quot;');
  });

  it('keeps a leading newline in a multi-line note, which HTML would otherwise drop after <pre>', async () => {
    const html = await formatPageHtml(pageUrl, [annotation({ note: '\nleading line' })], async () => undefined);

    expect(html).toContain('<pre>\n\nleading line</pre>');
  });

  it('orders the page annotations by createdAt, not by storage order', async () => {
    const html = await formatPageHtml(pageUrl,
      [
        annotation({ id: 'late', note: 'late note', createdAt: '2024-01-02T00:00:00.000Z' }),
        annotation({ id: 'early', note: 'early note', createdAt: '2024-01-01T00:00:00.000Z' }),
      ],
      async () => undefined,
    );

    expect(html.indexOf('early note')).toBeLessThan(html.indexOf('late note'));
  });
});
