// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { resolveSourcePath } from './source-path';

describe('resolveSourcePath', () => {
  it('reads a React fiber debug source', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, '__reactFiber$test', {
      configurable: true,
      value: {
        _debugSource: { fileName: '/src/App.tsx', lineNumber: 42 },
      },
    });

    expect(resolveSourcePath(element)).toEqual({
      fileName: '/src/App.tsx',
      lineNumber: 42,
    });
  });

  it('reads a data source hint', () => {
    const element = document.createElement('div');
    element.dataset.source = '/src/components/Card.tsx:18';

    expect(resolveSourcePath(element)).toEqual({
      fileName: '/src/components/Card.tsx',
      lineNumber: 18,
    });
  });

  it('returns null without throwing when no source is present', () => {
    const element = document.createElement('div');

    expect(() => resolveSourcePath(element)).not.toThrow();
    expect(resolveSourcePath(element)).toBeNull();
  });
});
