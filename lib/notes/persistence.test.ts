// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import { createNotePanelPersistence } from './persistence';
import { buildSelector } from '../capture/selector';

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
    status: 'open',
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('applies and reverts css edits on a shadow-deep element', () => {
    const host = document.createElement('x-card');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<div id="target"></div>';
    const light = document.createElement('div');
    light.id = 'target';
    document.body.append(light);
    const deep = root.querySelector('#target') as HTMLElement;
    const existing = annotation('annotation-1', buildSelector(deep));
    const persistence = createNotePanelPersistence();

    const edits = persistence.applyCssEdits(existing, [{ property: 'color', value: 'red' }]);
    expect(edits?.map((edit) => edit.property)).toEqual(['color']);
    expect(deep.style.getPropertyValue('color')).toBe('red');
    expect(light.style.getPropertyValue('color')).toBe('');

    persistence.revertCssEdits(existing);
    expect(deep.style.getPropertyValue('color')).toBe('');
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

  it('treats missing elements as safe no-ops and returns no edits', () => {
    const existing = annotation('annotation-1', '#missing');
    const persistence = createNotePanelPersistence();

    expect(persistence.applyCssEdits(existing, [{ property: 'color', value: 'red' }])).toBeUndefined();
    expect(() => {
      persistence.revertCssEdits(existing);
      persistence.revertAllCssEdits();
    }).not.toThrow();
  });

  it('captures each new property original from computed style before applying', () => {
    const element = document.createElement('div');
    element.id = 'target';
    element.style.setProperty('color', 'green');
    document.body.append(element);
    const existing = annotation('annotation-1', '#target');
    const persistence = createNotePanelPersistence();

    const edits = persistence.applyCssEdits(existing, [
      { property: 'color', value: 'red' },
      { property: 'display', value: 'flex' },
    ]);

    expect(edits).toEqual([
      { property: 'color', value: 'red', original: 'green' },
      { property: 'display', value: 'flex', original: 'block' },
    ]);
    expect(element.style.getPropertyValue('color')).toBe('red');
  });

  it('keeps the stored original instead of re-reading computed style', () => {
    const element = document.createElement('div');
    element.id = 'target';
    document.body.append(element);
    const existing = {
      ...annotation('annotation-1', '#target'),
      cssEdits: [{ property: 'color', value: 'red', original: 'rgb(0, 0, 0)' }],
    };
    const computed = vi.spyOn(window, 'getComputedStyle');
    const persistence = createNotePanelPersistence();

    const edits = persistence.applyCssEdits(existing, [{ property: 'color', value: 'blue' }]);

    expect(edits).toEqual([{ property: 'color', value: 'blue', original: 'rgb(0, 0, 0)' }]);
    expect(computed).not.toHaveBeenCalled();
  });

  it('never re-reads a property it currently applies', () => {
    const element = document.createElement('div');
    element.id = 'target';
    element.style.setProperty('color', 'green');
    document.body.append(element);
    const existing = annotation('annotation-1', '#target');
    const persistence = createNotePanelPersistence();

    persistence.applyCssEdits(existing, [{ property: 'color', value: 'red' }]);
    const edits = persistence.applyCssEdits(existing, [{ property: 'color', value: 'blue' }]);

    expect(edits).toEqual([{ property: 'color', value: 'blue', original: 'green' }]);
  });
});
