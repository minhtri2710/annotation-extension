import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import { format, exportTemplates } from './format';

const pageUrl = 'https://example.com/article';
const screenshot = 'data:image/png;base64,abc123';

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'annotation-1',
    pageUrl,
    note: 'Inspect this button',
    selector: '#submit-button',
    elementContext: {
      tagName: 'BUTTON',
      sourcePath: { fileName: 'src/App.tsx', lineNumber: 42 },
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Markdown annotation formatter', () => {
  it.each(exportTemplates.map((template) => template.id))(
    'includes annotation details for the %s template',
    (template) => {
      const markdown = format([annotation({ screenshot })], template, pageUrl);

      expect(markdown).toContain('Inspect this button');
      expect(markdown).toContain('#submit-button');
      expect(markdown).toContain('src/App.tsx:42');
      expect(markdown).toContain(pageUrl);
      expect(markdown).toContain('![Annotation screenshot](data:image/png;base64,abc123)');
    },
  );

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
      'generic',
      pageUrl,
    );

    expect(markdown).toContain('### Reproduction');
    expect(markdown).toContain('1. Open the page');
    expect(markdown).toContain('2. Click the submit button');
    expect(markdown).toContain('Expected: The form submits');
    expect(markdown).toContain('Actual: An error appears');
  });

  it('omits the repro block when an annotation has no repro', () => {
    const markdown = format([annotation()], 'generic', pageUrl);

    expect(markdown).not.toContain('### Reproduction');
    expect(markdown).not.toContain('Expected:');
    expect(markdown).not.toContain('Actual:');
  });

  it('omits the screenshot line when an annotation has no screenshot', () => {
    const markdown = format([annotation()], 'generic', pageUrl);

    expect(markdown).not.toContain('![Annotation screenshot]');
  });

  it('renders fixed templates differently for the same annotations', () => {
    const generic = format([annotation()], 'generic', pageUrl);
    const claudeCode = format([annotation()], 'claude-code', pageUrl);

    expect(generic).not.toBe(claudeCode);
  });

  it('renders a no-annotations message for an empty list', () => {
    expect(format([], 'generic', pageUrl)).toBe('No annotations found on this page.');
  });
});
