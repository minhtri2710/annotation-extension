import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { importAll, JsonImportError, parseImport, serialize } from './index';

const firstPage = 'https://example.com/docs?mode=full#intro';
const secondPage = 'https://example.com/settings';

const firstAnnotation: Annotation = {
  id: 'annotation-first',
  pageUrl: firstPage,
  note: 'Check the submit button',
  selector: 'form button[type="submit"]',
  elementContext: { tagName: 'BUTTON', text: 'Submit', sourcePath: { lineNumber: 42 } },
  createdAt: '2024-02-01T10:00:00.000Z',
  updatedAt: '2024-02-01T10:05:00.000Z',
  screenshot: 'data:image/png;base64,shot',
  repro: {
    steps: ['Open the form', 'Click Submit'],
    expected: 'The form is submitted',
    actual: 'An inline error appears',
  },
  cssEdits: [{ property: 'border-color', value: 'red' }],
};

const secondAnnotation: Annotation = {
  id: 'annotation-second',
  pageUrl: secondPage,
  note: 'Review account setting',
  selector: '#account-setting',
  elementContext: { tagName: 'SECTION', text: 'Account' },
  createdAt: '2024-02-02T11:00:00.000Z',
  updatedAt: '2024-02-02T11:00:00.000Z',
};

describe('JSON annotation I/O', () => {
  it('round-trips annotation inputs across pages without IDs or timestamps', () => {
    const plan = parseImport(serialize([firstAnnotation, secondAnnotation]));

    expect(plan).toEqual([
      {
        pageUrl: firstPage,
        input: {
          note: firstAnnotation.note,
          selector: firstAnnotation.selector,
          elementContext: firstAnnotation.elementContext,
          screenshot: firstAnnotation.screenshot,
          repro: firstAnnotation.repro,
          cssEdits: firstAnnotation.cssEdits,
        },
      },
      {
        pageUrl: secondPage,
        input: {
          note: secondAnnotation.note,
          selector: secondAnnotation.selector,
          elementContext: secondAnnotation.elementContext,
        },
      },
    ]);
    expect(plan[0]?.input).not.toHaveProperty('id');
    expect(plan[0]?.input).not.toHaveProperty('createdAt');
    expect(plan[0]?.input).not.toHaveProperty('updatedAt');
  });

  it('rejects malformed JSON and a JSON object instead of the expected array', () => {
    expect(() => parseImport('{not-json')).toThrow(JsonImportError);
    expect(() => parseImport(JSON.stringify({ annotations: [firstAnnotation] }))).toThrow(
      JsonImportError,
    );
  });

  it('drops array entries missing required fields while retaining valid entries', () => {
    const invalidEntry = {
      pageUrl: firstPage,
      note: 'Missing selector and element context',
    };
    const validEntry = {
      pageUrl: secondPage,
      note: secondAnnotation.note,
      selector: secondAnnotation.selector,
      elementContext: secondAnnotation.elementContext,
    };

    expect(parseImport(JSON.stringify([invalidEntry, validEntry]))).toEqual([
      {
        pageUrl: secondPage,
        input: {
          note: validEntry.note,
          selector: validEntry.selector,
          elementContext: validEntry.elementContext,
        },
      },
    ]);
  });

  it('sends one exact annotation.add message for each import entry', async () => {
    const plan = [
      {
        pageUrl: firstPage,
        input: {
          note: firstAnnotation.note,
          selector: firstAnnotation.selector,
          elementContext: firstAnnotation.elementContext,
          screenshot: firstAnnotation.screenshot,
          repro: firstAnnotation.repro,
          cssEdits: firstAnnotation.cssEdits,
        },
      },
      {
        pageUrl: secondPage,
        input: {
          note: secondAnnotation.note,
          selector: secondAnnotation.selector,
          elementContext: secondAnnotation.elementContext,
        },
      },
    ];
    const sent: AnnotationWriteMessage[] = [];

    await importAll(plan, async (message) => {
      sent.push(message);
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ type: 'annotation.add', pageUrl: firstPage, input: plan[0]!.input });
    expect(sent[1]).toEqual({ type: 'annotation.add', pageUrl: secondPage, input: plan[1]!.input });
  });
});
