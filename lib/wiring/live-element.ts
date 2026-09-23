import type { Annotation } from '../annotation';
import { resolveSelector } from '../capture/selector';
import type { ElementContext } from '../capture/context';

export function resolveLiveElementContext(
  document: Document,
  annotation: Annotation,
): ElementContext | undefined {
  const element = resolveSelector(document, annotation.selector);
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
