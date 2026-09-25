const HIGHLIGHT_MS = 1500;

export interface LocateHighlight {
  show(root: HTMLElement, el: Element): void;
  remove(): void;
}

export function scrollToElement(el: Element): void {
  const reduce = el.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView(reduce ? { block: 'center', inline: 'nearest', behavior: 'instant' } : { block: 'center', inline: 'nearest' });
}

// A smooth or later scroll moves elements under fixed boxes, so `update` re-runs once per frame after any
// scroll (capture) or window resize. Returns the function that detaches the listeners and any pending frame.
export function followFrames(document: Document, update: () => void): () => void {
  const view = document.defaultView!;
  let frame: number | undefined;
  const schedule = () => {
    frame ??= view.requestAnimationFrame(() => {
      frame = undefined;
      update();
    });
  };
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  view.addEventListener('resize', schedule, { passive: true });
  return () => {
    document.removeEventListener('scroll', schedule, { capture: true });
    view.removeEventListener('resize', schedule);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
  };
}

export function createLocateHighlight(): LocateHighlight {
  let highlight: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let stopFollowing = () => {};

  function show(root: HTMLElement, el: Element): void {
    scrollToElement(el);
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
    stopFollowing = followFrames(el.ownerDocument, place);
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
