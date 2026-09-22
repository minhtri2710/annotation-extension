import { buildSelector } from './selector';
import { resolveSourcePath, type SourcePath } from './source-path';

const MAX_TEXT_LENGTH = 200;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ElementContext {
  selector: string;
  tagName: string;
  id: string;
  classList: string[];
  text: string;
  boundingBox: BoundingBox;
  url: string;
  viewport: Viewport;
  sourcePath: SourcePath | null;
}

export function extractElementContext(element: Element): ElementContext {
  const rect = element.getBoundingClientRect();
  const ownerWindow = element.ownerDocument.defaultView;
  const text = (element.textContent ?? '').trim();

  return {
    selector: buildSelector(element),
    tagName: element.tagName,
    id: element.id,
    classList: Array.from(element.classList),
    text: text.slice(0, MAX_TEXT_LENGTH),
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    url: element.ownerDocument.location?.href ?? '',
    viewport: {
      width: ownerWindow?.innerWidth ?? 0,
      height: ownerWindow?.innerHeight ?? 0,
    },
    sourcePath: resolveSourcePath(element),
  };
}
