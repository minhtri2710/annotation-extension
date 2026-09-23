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

export interface AttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
}

export type AnnotationStatus = 'open' | 'resolved';

export interface Annotation {
  id: string;
  pageUrl: string;
  note: string;
  selector: string;
  elementContext: ElementContext;
  createdAt: string;
  updatedAt: string;
  status: AnnotationStatus;
  screenshot?: ScreenshotMetadata;
  attachments?: AttachmentMetadata[];
  repro?: Repro;
  cssEdits?: CssEdit[];
}

export type AnnotationInput = Pick<
  Annotation,
  'note' | 'selector' | 'elementContext' | 'repro' | 'cssEdits'
> & {
  status?: AnnotationStatus;
};

export type AnnotationUpdate = Partial<AnnotationInput>;
