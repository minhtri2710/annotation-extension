export interface Repro {
  steps: string[];
  expected: string;
  actual: string;
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
}

export type AnnotationInput = Pick<
  Annotation,
  'note' | 'selector' | 'elementContext' | 'screenshot' | 'repro'
>;

export type AnnotationUpdate = Partial<AnnotationInput>;
