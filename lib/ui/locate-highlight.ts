const HIGHLIGHT_MS = 1500;

export interface LocateHighlight {
  show(root: HTMLElement, el: Element): void;
  remove(): void;
}

export function createLocateHighlight(): LocateHighlight {
  let highlight: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let stopFollowing = () => {};

  function show(root: HTMLElement, el: Element): void {
    const document = el.ownerDocument;
    const view = document.defaultView!;
    const reduce = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView(reduce ? { block: 'center', inline: 'nearest', behavior: 'instant' } : { block: 'center', inline: 'nearest' });
    remove();
    const box = root.ownerDocument.createElement('div');
    box.dataset.annotationScanHighlight = '';
    box.style.position = 'fixed';
    const place = () => {
      const rect = el.getBoundingClientRect();
      Object.assign(box.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };
    place();
    // A smooth or later scroll moves the element, so the fixed box is re-placed once per frame while shown.
    let frame: number | undefined;
    const schedule = () => {
      frame ??= view.requestAnimationFrame(() => {
        frame = undefined;
        place();
      });
    };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    view.addEventListener('resize', schedule, { passive: true });
    stopFollowing = () => {
      document.removeEventListener('scroll', schedule, { capture: true });
      view.removeEventListener('resize', schedule);
      if (frame !== undefined) view.cancelAnimationFrame(frame);
    };
    highlight = box;
    root.append(box);
    highlightTimer = setTimeout(remove, HIGHLIGHT_MS);
  }

  function remove(): void {
    clearTimeout(highlightTimer);
    highlightTimer = undefined;
    stopFollowing();
    stopFollowing = () => {};
    highlight?.remove();
    highlight = undefined;
  }

  return { show, remove };
}
