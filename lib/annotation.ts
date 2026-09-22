import type { ElementContext } from './capture/context';

export interface Repro {
  steps: string[];
  expected: string;
  actual: string;
}

export interface CssEdit {
  property: string;
  value: string;
}

export interface ScreenshotMetadata {
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface Annotation {
  id: string;
  pageUrl: string;
  note: string;
  selector: string;
  elementContext: ElementContext;
  createdAt: string;
  updatedAt: string;
  screenshot?: ScreenshotMetadata;
  repro?: Repro;
  cssEdits?: CssEdit[];
}

export type AnnotationInput = Pick<
  Annotation,
  'note' | 'selector' | 'elementContext' | 'repro' | 'cssEdits'
>;

export type AnnotationUpdate = Partial<AnnotationInput>;
