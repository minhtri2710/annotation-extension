import type { Annotation } from '../annotation';
import { resolveElement } from '../pins/pins';
import type { ElementContext } from '../capture/context';

export function resolveLiveElementContext(
  document: Document,
  annotation: Annotation,
): ElementContext | undefined {
  const element = resolveElement(document, annotation.selector);
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
