const HIGHLIGHT_MS = 1500;

export interface LocateHighlight {
  show(root: HTMLElement, el: Element): void;
  remove(): void;
}

export function createLocateHighlight(): LocateHighlight {
  let highlight: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  function show(root: HTMLElement, el: Element): void {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    remove();
    const rect = el.getBoundingClientRect();
    highlight = root.ownerDocument.createElement('div');
    highlight.dataset.annotationScanHighlight = '';
    Object.assign(highlight.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    root.append(highlight);
    highlightTimer = setTimeout(remove, HIGHLIGHT_MS);
  }

  function remove(): void {
    clearTimeout(highlightTimer);
    highlightTimer = undefined;
    highlight?.remove();
    highlight = undefined;
  }

  return { show, remove };
}
