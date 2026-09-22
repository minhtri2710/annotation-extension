import { browser } from 'wxt/browser';
import { isRecord } from './guards';
import type { ElementContext } from './capture/context';
import type {
  Annotation,
  AnnotationInput,
  AnnotationUpdate,
  CssEdit,
  Repro,
} from './annotation';

export type AnnotationWriteMessage =
  | { type: 'annotation.add'; pageUrl: string; input: AnnotationInput }
  | { type: 'annotation.update'; pageUrl: string; id: string; changes: AnnotationUpdate }
  | { type: 'annotation.delete'; pageUrl: string; id: string }
  | { type: 'annotation.clear'; pageUrl: string };

export type AnnotationWriteResponse<T extends AnnotationWriteMessage> = T extends {
  type: 'annotation.add';
}
  ? Annotation
  : T extends { type: 'annotation.update' }
    ? Annotation | null
    : T extends { type: 'annotation.delete' }
      ? boolean
      : void;

export function isAnnotationWriteMessage(value: unknown): value is AnnotationWriteMessage {
  if (!isRecord(value) || typeof value.pageUrl !== 'string' || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'annotation.add':
      return isAnnotationInput(value.input);
    case 'annotation.update':
      return typeof value.id === 'string' && isAnnotationUpdate(value.changes);
    case 'annotation.delete':
      return typeof value.id === 'string';
    case 'annotation.clear':
      return true;
    default:
      return false;
  }
}

export function sendAnnotationWrite<T extends AnnotationWriteMessage>(
  message: T,
): Promise<AnnotationWriteResponse<T>> {
  return browser.runtime.sendMessage<AnnotationWriteMessage, AnnotationWriteResponse<T>>(message);
}

export function isCssEdit(value: unknown): value is CssEdit {
  return isRecord(value) && typeof value.property === 'string' && typeof value.value === 'string';
}

export function isCssEdits(value: unknown): value is CssEdit[] {
  return Array.isArray(value) && value.every(isCssEdit);
}

function isAnnotationInput(value: unknown): value is AnnotationInput {
  return (
    isRecord(value) &&
    typeof value.note === 'string' &&
    typeof value.selector === 'string' &&
    isElementContext(value.elementContext) &&
    (value.screenshot === undefined || typeof value.screenshot === 'string') &&
    (value.repro === undefined || isRepro(value.repro)) &&
    (value.cssEdits === undefined || isCssEdits(value.cssEdits))
  );
}

function isAnnotationUpdate(value: unknown): value is AnnotationUpdate {
  if (!isRecord(value)) return false;
  return (
    (value.note === undefined || typeof value.note === 'string') &&
    (value.selector === undefined || typeof value.selector === 'string') &&
    (value.elementContext === undefined || isElementContext(value.elementContext)) &&
    (value.screenshot === undefined || typeof value.screenshot === 'string') &&
    (value.repro === undefined || isRepro(value.repro)) &&
    (value.cssEdits === undefined || isCssEdits(value.cssEdits))
  );
}

function isRepro(value: unknown): value is Repro {
  return (
    isRecord(value) &&
    Array.isArray(value.steps) &&
    value.steps.every((step) => typeof step === 'string') &&
    typeof value.expected === 'string' &&
    typeof value.actual === 'string'
  );
}

export function isElementContext(value: unknown): value is ElementContext {
  if (!isRecord(value)) return false;
  const boundingBox = value.boundingBox;
  const viewport = value.viewport;
  if (
    !isRecord(boundingBox) ||
    !isRecord(viewport) ||
    typeof value.selector !== 'string' ||
    typeof value.tagName !== 'string' ||
    typeof value.id !== 'string' ||
    !isStringArray(value.classList) ||
    typeof value.text !== 'string' ||
    !isFiniteNumber(boundingBox.x) ||
    !isFiniteNumber(boundingBox.y) ||
    !isFiniteNumber(boundingBox.width) ||
    !isFiniteNumber(boundingBox.height) ||
    typeof value.url !== 'string' ||
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height)
  ) {
    return false;
  }

  return value.sourcePath === null || isSourcePath(value.sourcePath);
}

function isSourcePath(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    (value.lineNumber === undefined || isFiniteNumber(value.lineNumber))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
