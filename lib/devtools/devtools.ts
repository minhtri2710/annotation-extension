import type { Annotation } from '../annotation';
import { SHADOW_SELECTOR_DELIMITER } from '../capture/selector';

export interface AnnotationRow {
  note: string;
  selector: string;
}

export function buildInspectExpression(selector: string): string {
  const path = selector
    .split(SHADOW_SELECTOR_DELIMITER)
    .map((part) => `querySelector(${JSON.stringify(part)})`)
    .join('?.shadowRoot?.');
  return `inspect(document.${path})`;
}

export function buildAnnotationRows(annotations: Annotation[]): AnnotationRow[] {
  return annotations.map(({ note, selector }) => ({ note, selector }));
}
