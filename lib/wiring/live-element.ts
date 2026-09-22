import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';

export function resolveLiveElementContext(
  document: Document,
  annotation: Annotation,
): ElementContext | undefined {
  let element: Element | null;
  try {
    element = document.querySelector(annotation.selector);
  } catch {
    return undefined;
  }
  if (!element) return undefined;

  const rect = element.getBoundingClientRect();
  return {
    ...annotation.elementContext,
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}
