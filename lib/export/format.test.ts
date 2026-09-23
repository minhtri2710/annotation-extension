import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { attachmentAssetFilename, format, screenshotAssetFilename } from './format';

const pageUrl = 'https://example.com/article';

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'annotation-1',
    pageUrl,
    note: 'Inspect this button',
    selector: '#submit-button',
    elementContext: {
      selector: '#submit-button',
      tagName: 'BUTTON',
      id: 'submit-button',
      classList: ['primary', 'wide'],
      text: 'Inspect this button',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      url: pageUrl,
      viewport: { width: 1280, height: 720 },
      sourcePath: { fileName: 'src/App.tsx', lineNumber: 42 },
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

describe('Markdown annotation formatter', () => {
  it('includes the header, element context, source, and relative screenshot asset link', () => {
    const markdown = format(
      [annotation({ screenshot: { mimeType: 'image/webp', width: 800, height: 400, byteLength: 12 } })],
      pageUrl,
    );

    expect(markdown).toContain('# Page annotations');
    expect(markdown).toContain(`Page URL: ${pageUrl}`);
    expect(markdown).toContain('Host: example.com');
    expect(markdown).toContain('Annotation count: 1');
    expect(markdown).toContain('Inspect this button');
    expect(markdown).toContain('#submit-button');
    expect(markdown).toContain('- Element: BUTTON#submit-button.primary.wide "Inspect this button"');
    expect(markdown).toContain('src/App.tsx:42');
    expect(markdown).toContain('![Annotation screenshot](./annotations-annotation-1.webp)');
  });

  it('renders status and attachment links', () => {
    const markdown = format([annotation({
      status: 'resolved',
      attachments: [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 }],
    })], pageUrl);
    expect(markdown).toContain('- Status: resolved');
    expect(markdown).toContain('### Attachments');
    expect(markdown).toContain('[photo.png](./annotations-annotation-1-attachment-1.png)');
  });

  it('derives asset extensions from MIME type', () => {
    expect(screenshotAssetFilename('one', 'image/webp')).toBe('annotations-one.webp');
    expect(screenshotAssetFilename('two', 'image/jpeg')).toBe('annotations-two.jpeg');
    expect(screenshotAssetFilename('three', 'image/png')).toBe('annotations-three.png');
    expect(attachmentAssetFilename('four', 0, 'image/png')).toBe('annotations-four-attachment-1.png');
  });

  it('orders annotations by createdAt regardless of input order', () => {
    const older = annotation({ id: 'older', note: 'Older note', createdAt: '2024-01-01T00:00:00.000Z' });
    const newer = annotation({ id: 'newer', note: 'Newer note', createdAt: '2024-01-02T00:00:00.000Z' });
    const markdown = format([newer, older], pageUrl);

    expect(markdown.indexOf('Older note')).toBeLessThan(markdown.indexOf('Newer note'));
    expect(markdown).toContain('## Annotation 1');
    expect(markdown).toContain('## Annotation 2');
    expect(markdown.indexOf('## Annotation 1')).toBeLessThan(markdown.indexOf('## Annotation 2'));
  });

  it('renders repro steps and expected versus actual details', () => {
    const markdown = format(
      [
        annotation({
          repro: {
            steps: ['Open the page', 'Click the submit button'],
            expected: 'The form submits',
            actual: 'An error appears',
          },
        }),
      ],
      pageUrl,
    );

    expect(markdown).toContain('### Reproduction');
    expect(markdown).toContain('1. Open the page');
    expect(markdown).toContain('2. Click the submit button');
    expect(markdown).toContain('Expected: The form submits');
    expect(markdown).toContain('Actual: An error appears');
  });

  it('renders css tweaks when an annotation has non-empty css edits', () => {
    const markdown = format(
      [
        annotation({
          cssEdits: [
            { property: 'color', value: 'red', original: 'rgb(0, 0, 0)' },
            { property: 'margin', value: '1rem', original: '0px' },
          ],
        }),
      ],
      pageUrl,
    );

    expect(markdown).toContain('### CSS tweaks');
    expect(markdown).toContain('### CSS tweaks\ncolor: rgb(0, 0, 0) -> red\nmargin: 0px -> 1rem');
  });

  it('omits optional blocks when their data is absent', () => {
    const markdown = format([annotation()], pageUrl);

    expect(markdown).not.toContain('### CSS tweaks');
    expect(markdown).not.toContain('### Reproduction');
    expect(markdown).not.toContain('![Annotation screenshot]');
  });

  it('renders a no-annotations message for an empty list', () => {
    expect(format([], pageUrl)).toBe('No annotations found on this page.');
  });
});
