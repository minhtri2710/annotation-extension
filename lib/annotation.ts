export interface Repro {
  steps: string[];
  expected: string;
  actual: string;
}

export interface CssEdit {
  property: string;
  value: string;
}

export interface Annotation {
  id: string;
  pageUrl: string;
  note: string;
  selector: string;
  elementContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  screenshot?: string;
  repro?: Repro;
  cssEdits?: CssEdit[];
}

export type AnnotationInput = Pick<
  Annotation,
  'note' | 'selector' | 'elementContext' | 'screenshot' | 'repro' | 'cssEdits'
>;

export type AnnotationUpdate = Partial<AnnotationInput>;
