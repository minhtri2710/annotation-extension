import type { Annotation } from '../annotation';

export interface AnnotationRow {
  note: string;
  selector: string;
}

export function buildInspectExpression(selector: string): string {
  return `inspect(document.querySelector(${JSON.stringify(selector)}))`;
}

export function buildAnnotationRows(annotations: Annotation[]): AnnotationRow[] {
  return annotations.map(({ note, selector }) => ({ note, selector }));
}
