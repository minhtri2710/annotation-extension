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
    expect(markdown).toContain('### CSS tweaks\n```\ncolor: rgb(0, 0, 0) -> red\nmargin: 0px -> 1rem\n```');
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
        '### Reproduction\n```\n1. Open\nExpected: Works\nActual: Breaks\n```',
        '### CSS tweaks\n```\ncolor: blue -> red\n```',
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
    expect(markdown).toContain('##### CSS tweaks\n```\ncolor: blue -> red\n```');
    expect(markdown).not.toMatch(/^## Annotation/m);
    expect(markdown).toContain('#### Annotation 1\n- Note: Older note\n- Status: open');
  });
});

/** Lines outside fenced code blocks; fences may sit inside a list item (indented up to 3 spaces). */
function linesOutsideFences(markdown: string): string[] {
  const outside: string[] = [];
  let fence = 0;
  for (const line of markdown.split('\n')) {
    const run = /^ {0,3}(`{3,})\s*$/.exec(line)?.[1]?.length ?? 0;
    if (fence === 0 && run > 0) fence = run;
    else if (fence > 0 && run >= fence) fence = 0;
    else if (fence === 0) outside.push(line);
  }
  expect(fence, 'every fence closes').toBe(0);
  return outside;
}

const OWN_HEADING = /^#{1,6} (?:Page annotations|All annotations|Annotation \d+|Attachments|Reproduction|CSS tweaks|example\.com|https:\/\/example\.com\/\S*)$/;
const OWN_LIST_ITEM = /^- (?:Note:|Status: |Selector: |Element: |Source: |\\?\[)/;

function expectOnlyOwnStructure(markdown: string, assetLinks: number): void {
  const outside = linesOutsideFences(markdown);
  for (const line of outside) {
    if (line.startsWith('#')) expect(line).toMatch(OWN_HEADING);
    if (/^\s*(?:[-*+]|\d+[.)])(?:\s|$)/.test(line)) expect(line).toMatch(OWN_LIST_ITEM);
    expect(line).not.toMatch(/^\s*(?:>|<|\||={2,}|-{3,})/);
    expect(line).not.toMatch(/^ {4,}\S/);
  }
  const text = outside.join('\n');
  expect(text).not.toMatch(/(?<!\\)<[a-z/!?]/i);
  expect(text.match(/(?<!\\)\]\(/g) ?? []).toHaveLength(assetLinks);
  expect(text).not.toMatch(/\r/);
}

const hostile = [
  '# injected',
  '## after CRLF\r\n### and again',
  '- item',
  '> quote',
  '| a | b |',
  '|---|---|',
  '<script>alert(1)</script>',
  '[x](javascript:alert(1)) ![i](y)',
  '```',
  '````not closed',
  '1. numbered',
  '===',
  '    indented code',
].join('\n');

describe('Markdown export keeps user text inside its block', () => {
  const adversarial = annotation({
    note: hostile,
    selector: 'a[href="x"] > b | <i>\n# sel',
    repro: { steps: ['# step', 'two\r\n- list', '````'], expected: '<script>x</script>', actual: '# injected\n```' },
    cssEdits: [{ property: '# prop', value: '```\n# v', original: 'blue\r\n# h' }],
    attachments: [
      { id: 'att-1', name: 'big](evil.md) [x.png', mimeType: 'image/png', byteLength: 1 },
      { id: 'att-2', name: '<img src=x onerror=alert(1)>.png', mimeType: 'image/jpeg', byteLength: 1 },
    ],
    screenshot: { mimeType: 'image/png', width: 1, height: 1, byteLength: 1 },
  });

  it('confines hostile note, selector, repro, CSS and attachment text to its list item or fenced block', () => {
    const markdown = format([adversarial], pageUrl);
    expectOnlyOwnStructure(markdown, 3);
    expect(markdown).toContain('- [big\\](evil.md) \\[x.png](./annotations-annotation-1-attachment-1.png)');
    expect(markdown).toContain('- [\\<img src=x onerror=alert(1)\\>.png](./annotations-annotation-1-attachment-2.jpeg)');
    expect(markdown).toContain('![Annotation screenshot](./annotations-annotation-1.png)');
    expect(markdown).toContain('- Selector: a\\[href="x"\\] \\> b \\| \\<i\\> # sel');
    expect(markdown).toContain(`- Note:\n  \`\`\`\`\`\n${hostile.replace(/\r\n/g, '\n').split('\n').map((line) => `  ${line}`).join('\n')}\n  \`\`\`\`\``);
    expect(markdown).toContain('### Reproduction\n`````\n1. # step\n2. two\n- list\n3. ````\nExpected: <script>x</script>\nActual: # injected\n```\n`````');
    expect(markdown).toContain('### CSS tweaks\n````\n# prop: blue\n# h -> ```\n# v\n````');
  });

  it('confines the same text in the all-pages export', () => {
    const markdown = formatAllPages([adversarial, annotation({ id: 'b', note: 'Plain', pageUrl: 'https://example.com/a?q=[x](y)|z' })]);
    expectOnlyOwnStructure(markdown, 3);
    expect(markdown).toContain('### https://example.com/a?q=\\[x\\](y)\\|z');
  });

  it('keeps emoji, combining marks, RTL and long lines verbatim in a single-line note', () => {
    const note = `Café 👩🏽‍💻 e\u0301 שלום مرحبا ${'x'.repeat(5000)} a*b_c`;
    const markdown = format([annotation({ note })], pageUrl);
    expect(markdown).toContain(`- Note: ${note}\n`);
    expectOnlyOwnStructure(markdown, 0);
  });

  it('escapes link text and percent-encodes link targets while asset links still name the downloaded files', () => {
    const markdown = format([annotation({
      id: 'x y(1)',
      screenshot: { mimeType: 'image/png', width: 1, height: 1, byteLength: 1 },
      attachments: [{ id: 'a', name: 'ok.png', mimeType: 'image/png', byteLength: 1 }],
    })], pageUrl);
    expect(markdown).toContain(`![Annotation screenshot](./${encodeURI(screenshotAssetFilename('x y(1)', 'image/png')).replace('(', '%28').replace(')', '%29')})`);
    expect(markdown).toContain('- [ok.png](./annotations-x%20y%281%29-attachment-1.png)');
    expect(decodeURIComponent('annotations-x%20y%281%29-attachment-1.png')).toBe(attachmentAssetFilename('x y(1)', 0, 'image/png'));
  });

  it('uses a fence longer than any backtick run in the content', () => {
    const markdown = format([annotation({ cssEdits: [{ property: 'content', value: '"``````"', original: 'none' }] })], pageUrl);
    expect(markdown).toContain('### CSS tweaks\n```````\ncontent: none -> "``````"\n```````');
  });
});
