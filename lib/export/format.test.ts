import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { attachmentAssetFilename, format, formatAllPages, screenshotAssetFilename } from './format';

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

describe('Markdown annotation formatter byte identity', () => {
  it('renders the exact per-page document for a fully populated annotation', () => {
    const markdown = format(
      [
        annotation({
          screenshot: { mimeType: 'image/png', width: 10, height: 10, byteLength: 1 },
          attachments: [{ id: 'attachment-1', name: 'photo.png', mimeType: 'image/png', byteLength: 4 }],
          repro: { steps: ['Open'], expected: 'Works', actual: 'Breaks' },
          cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
        }),
      ],
      pageUrl,
    );

    expect(markdown).toBe([
      '# Page annotations',
      'Review the following annotations for this page.',
      `Page URL: ${pageUrl}`,
      'Host: example.com',
      'Annotation count: 1',
      [
        '## Annotation 1',
        '- Note: Inspect this button',
        '- Status: open',
        '- Selector: #submit-button',
        '- Element: BUTTON#submit-button.primary.wide "Inspect this button"',
        '- Source: src/App.tsx:42',
        '![Annotation screenshot](./annotations-annotation-1.png)',
        '### Attachments\n- [photo.png](./annotations-annotation-1-attachment-1.png)',
        '### Reproduction\n1. Open\nExpected: Works\nActual: Breaks',
        '### CSS tweaks\ncolor: blue -> red',
      ].join('\n'),
    ].join('\n\n'));
  });
});

describe('All-pages Markdown formatter', () => {
  const otherPage = 'https://example.com/about';
  const otherHost = 'https://alpha.test/home';

  it('renders a fixed message for zero annotations', () => {
    expect(formatAllPages([])).toBe('No annotations found.');
  });

  it('groups by sorted host then sorted page with totals and per-page counts', () => {
    const markdown = formatAllPages([
      annotation({ id: 'a', note: 'Article note' }),
      annotation({ id: 'b', note: 'About note', pageUrl: otherPage }),
      annotation({ id: 'c', note: 'Alpha note', pageUrl: otherHost }),
    ]);

    expect(markdown.startsWith('# All annotations\n\nTotal annotation count: 3\n\n')).toBe(true);
    const alpha = markdown.indexOf('## alpha.test');
    const example = markdown.indexOf('## example.com');
    const about = markdown.indexOf(`### ${otherPage}`);
    const article = markdown.indexOf(`### ${pageUrl}`);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(markdown.indexOf(`### ${otherHost}`));
    expect(markdown.indexOf(`### ${otherHost}`)).toBeLessThan(example);
    expect(example).toBeLessThan(about);
    expect(about).toBeLessThan(article);
    expect(markdown.indexOf('About note')).toBeLessThan(article);
    expect(markdown.indexOf('Article note')).toBeGreaterThan(article);
    expect(markdown.match(/^Annotation count: 1$/gm)).toHaveLength(3);
  });

  it('orders by createdAt within a page, restarts numbering per page, and nests headings one level deeper', () => {
    const markdown = formatAllPages([
      annotation({ id: 'newer', note: 'Newer note', createdAt: '2024-01-02T00:00:00.000Z' }),
      annotation({
        id: 'older',
        note: 'Older note',
        createdAt: '2024-01-01T00:00:00.000Z',
        cssEdits: [{ property: 'color', value: 'red', original: 'blue' }],
      }),
      annotation({ id: 'about', note: 'About note', pageUrl: otherPage }),
    ]);

    expect(markdown).toContain(`### ${pageUrl}\n\nAnnotation count: 2`);
    expect(markdown.indexOf('Older note')).toBeLessThan(markdown.indexOf('Newer note'));
    expect(markdown.match(/^#### Annotation 1$/gm)).toHaveLength(2);
    expect(markdown.match(/^#### Annotation 2$/gm)).toHaveLength(1);
    expect(markdown).toContain('##### CSS tweaks\ncolor: blue -> red');
    expect(markdown).not.toMatch(/^## Annotation/m);
    expect(markdown).toContain('#### Annotation 1\n- Note: Older note\n- Status: open');
  });
});
