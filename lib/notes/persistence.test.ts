// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createNotePanelPersistence } from './persistence';

const pageUrl = 'https://example.com/article';
const elementContext: ElementContext = {
  selector: '#target',
  tagName: 'DIV',
  id: 'target',
  classList: [],
  text: '',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  url: pageUrl,
  viewport: { width: 1280, height: 720 },
  sourcePath: null,
};

function annotation(id: string, selector: string): Annotation {
  return {
    id,
    pageUrl,
    note: id,
    selector,
    elementContext,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('note panel persistence css edits', () => {
  it('reverts only seam-applied properties and keeps unrelated inline styles', () => {
    const element = document.createElement('div');
    element.id = 'target';
    element.style.setProperty('background-color', 'yellow');
    document.body.append(element);
    const existing = annotation('annotation-1', '#target');
    const persistence = createNotePanelPersistence();

    persistence.applyCssEdits(existing, [
      { property: 'color', value: 'red' },
      { property: 'display', value: 'block' },
    ]);
    persistence.revertCssEdits(existing);

    expect(element.style.getPropertyValue('color')).toBe('');
    expect(element.style.getPropertyValue('display')).toBe('');
    expect(element.style.getPropertyValue('background-color')).toBe('yellow');
  });

  it('reverts all tracked properties across annotations', () => {
    const first = document.createElement('div');
    first.id = 'first';
    const second = document.createElement('div');
    second.id = 'second';
    document.body.append(first, second);
    const firstAnnotation = annotation('annotation-1', '#first');
    const secondAnnotation = annotation('annotation-2', '#second');
    const persistence = createNotePanelPersistence();

    persistence.applyCssEdits(firstAnnotation, [{ property: 'color', value: 'red' }]);
    persistence.applyCssEdits(secondAnnotation, [{ property: 'margin', value: '1rem' }]);
    persistence.revertAllCssEdits();

    expect(first.style.getPropertyValue('color')).toBe('');
    expect(second.style.getPropertyValue('margin')).toBe('');
  });

  it('removes orphaned properties when an annotation edit set shrinks', () => {
    const element = document.createElement('div');
    element.id = 'target';
    document.body.append(element);
    const existing = annotation('annotation-1', '#target');
    const persistence = createNotePanelPersistence();

    persistence.applyCssEdits(existing, [
      { property: 'color', value: 'red' },
      { property: 'display', value: 'block' },
    ]);
    persistence.applyCssEdits(existing, [{ property: 'color', value: 'blue' }]);

    expect(element.style.getPropertyValue('color')).toBe('blue');
    expect(element.style.getPropertyValue('display')).toBe('');
  });

  it('treats missing elements as safe no-ops', () => {
    const existing = annotation('annotation-1', '#missing');
    const persistence = createNotePanelPersistence();

    expect(() => {
      persistence.applyCssEdits(existing, [{ property: 'color', value: 'red' }]);
      persistence.revertCssEdits(existing);
      persistence.revertAllCssEdits();
    }).not.toThrow();
  });
});
