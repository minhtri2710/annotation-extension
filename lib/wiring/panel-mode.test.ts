// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElementContext } from '../capture/context';
import { createPanelMode } from './panel-mode';

const context: ElementContext = {
  selector: '#target',
  tagName: 'div',
  id: 'target',
  classList: [],
  text: '',
  boundingBox: { x: 1, y: 2, width: 3, height: 4 },
  url: 'https://example.test/',
  viewport: { width: 800, height: 600 },
  sourcePath: null,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const panel = document.createElement('div');
  const inner = document.createElement('button');
  panel.append(inner);
  const listToggle = document.createElement('button');
  const scanToggle = document.createElement('button');
  const outside = document.createElement('button');
  document.body.append(panel, listToggle, scanToggle, outside);
  const anchor = { place: vi.fn(), clear: vi.fn() };
  const anchorToToolbar = () => ({ x: 0, y: 0, width: 10, height: 10 });
  const notePanel = { render: vi.fn(() => Promise.resolve()), clear: vi.fn() };
  const scanPanel = { render: vi.fn(() => Promise.resolve()), clear: vi.fn() };
  const list = { render: vi.fn(() => Promise.resolve()), clear: vi.fn() };
  const panels = createPanelMode({
    panel,
    overlayRoot: document,
    anchor,
    anchorToToolbar,
    notePanel,
    scanPanel,
    annotationList: () => list,
    listToggle,
    scanToggle,
  });
  return { panels, panel, inner, listToggle, scanToggle, outside, anchor, anchorToToolbar, notePanel, scanPanel, list };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createPanelMode', () => {
  it('closes the open mode when its toggle runs again', () => {
    const { panels, list, listToggle } = setup();
    panels.toggle('list');
    expect(panels.mode()).toBe('list');
    expect(panels.opener()).toBe(listToggle);
    expect(listToggle.getAttribute('aria-expanded')).toBe('true');

    panels.toggle('list');

    expect(panels.mode()).toBe('none');
    expect(panels.opener()).toBeUndefined();
    expect(list.clear).toHaveBeenCalledTimes(1);
    expect(listToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('resets the other mode when one opens', () => {
    const { panels, list, scanPanel, listToggle, scanToggle } = setup();
    panels.toggle('list');

    panels.toggle('scan');

    expect(panels.mode()).toBe('scan');
    expect(list.clear).toHaveBeenCalledTimes(1);
    expect(scanPanel.clear).not.toHaveBeenCalled();
    expect(listToggle.getAttribute('aria-expanded')).toBe('false');
    expect(scanToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('never places the anchor for a stale render', async () => {
    const { panels, anchor, notePanel } = setup();
    const first = deferred();
    const second = deferred();
    notePanel.render.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const staleContext = { ...context, boundingBox: { x: 9, y: 9, width: 9, height: 9 } };

    panels.showNote(staleContext, undefined);
    panels.showNote(context, undefined);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(anchor.place).not.toHaveBeenCalled();

    second.resolve();
    await second.promise;
    await Promise.resolve();
    expect(anchor.place).toHaveBeenCalledTimes(1);
    const box = anchor.place.mock.calls[0]?.[0] as (() => unknown) | undefined;
    expect(box?.()).toBe(context.boundingBox);
  });

  it('never places the anchor for a list render superseded by a reopen of the same mode', async () => {
    const { panels, anchor, anchorToToolbar, list } = setup();
    const first = deferred();
    const second = deferred();
    list.render.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    panels.toggle('list');
    panels.toggle('list');
    panels.toggle('list');
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(anchor.place).not.toHaveBeenCalled();

    second.resolve();
    await second.promise;
    await Promise.resolve();
    expect(anchor.place).toHaveBeenCalledTimes(1);
    expect(anchor.place).toHaveBeenCalledWith(anchorToToolbar);
  });

  it.each(['list', 'scan'] as const)('never places the anchor for a %s render that resolves after the mode closed', async (mode) => {
    const { panels, anchor, list, scanPanel } = setup();
    const render = deferred();
    (mode === 'list' ? list : scanPanel).render.mockReturnValueOnce(render.promise);

    panels.toggle(mode);
    panels.close();
    render.resolve();
    await render.promise;
    await Promise.resolve();

    expect(anchor.place).not.toHaveBeenCalled();
  });

  it('returns focus to the opener on close only when focus was in the panel', () => {
    const { panels, inner, outside, listToggle } = setup();
    panels.toggle('list');
    inner.focus();
    panels.close();
    expect(document.activeElement).toBe(listToggle);

    panels.toggle('list');
    outside.focus();
    panels.close();
    expect(document.activeElement).toBe(outside);
  });

  it('passes the seed to the note panel and places the anchor at the context box', async () => {
    const { panels, notePanel, anchor, outside } = setup();

    panels.showNote(context, outside, 'Seed note');

    expect(notePanel.render).toHaveBeenCalledWith(context, 'Seed note');
    expect(panels.mode()).toBe('note');
    expect(panels.opener()).toBe(outside);
    await Promise.resolve();
    await Promise.resolve();
    const box = anchor.place.mock.calls[0]?.[0] as (() => unknown) | undefined;
    expect(box?.()).toBe(context.boundingBox);
  });

  it('labels the panel for each mode and removes the label on close', () => {
    const { panels, panel } = setup();
    panels.showNote(context, undefined);
    expect(panel.getAttribute('aria-label')).toBe('Annotation note');
    panels.toggle('list');
    expect(panel.getAttribute('aria-label')).toBe('Annotations on this page');
    panels.toggle('scan');
    expect(panel.getAttribute('aria-label')).toBe('Page scan');

    panels.close();

    expect(panel.hasAttribute('aria-label')).toBe(false);
  });
});
