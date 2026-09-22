// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import { resolveLiveElementContext } from './live-element';

const pageUrl = 'https://example.com/article';
const annotation: Annotation = {
  id: 'annotation-1',
  pageUrl,
  note: 'Live anchor',
  selector: '#target',
  elementContext: {
    selector: '#target',
    tagName: 'BUTTON',
    id: 'target',
    classList: [],
    text: 'Target',
    boundingBox: { x: 1, y: 2, width: 10, height: 10 },
    url: pageUrl,
    viewport: { width: 1280, height: 720 },
    sourcePath: null,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe('live annotation anchoring', () => {
  it('uses the current element rect instead of the stored capture-time box', () => {
    const target = document.createElement('button');
    target.id = 'target';
    const getBoundingClientRect = vi.fn(() => ({
      x: 300,
      y: 400,
      width: 120,
      height: 50,
      top: 400,
      right: 420,
      bottom: 450,
      left: 300,
      toJSON: () => ({}),
    }) as DOMRect);
    target.getBoundingClientRect = getBoundingClientRect;
    document.body.append(target);

    const context = resolveLiveElementContext(document, annotation);

    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(context?.boundingBox).toEqual({ x: 300, y: 400, width: 120, height: 50 });
    expect(context?.boundingBox).not.toEqual(annotation.elementContext.boundingBox);
  });

  it('does not open from stale coordinates when the selector no longer resolves', () => {
    expect(resolveLiveElementContext(document, annotation)).toBeUndefined();
  });
});
