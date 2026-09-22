export interface Annotation {
  id: string;
  pageUrl: string;
  note: string;
  selector: string;
  elementContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AnnotationInput = Pick<Annotation, 'note' | 'selector' | 'elementContext'>;

export type AnnotationUpdate = Partial<AnnotationInput>;
