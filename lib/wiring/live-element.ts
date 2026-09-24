import type { Annotation } from '../annotation';
import { resolveElementBox } from '../capture/selector';
import type { ElementContext } from '../capture/context';

export function resolveLiveElementContext(
  document: Document,
  annotation: Annotation,
): ElementContext | undefined {
  const boundingBox = resolveElementBox(document, annotation.selector);
  if (!boundingBox) return undefined;

  return { ...annotation.elementContext, boundingBox };
}
