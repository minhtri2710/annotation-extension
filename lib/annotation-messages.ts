import { browser } from 'wxt/browser';
import type { Annotation, AnnotationInput, AnnotationUpdate } from './annotation';

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

function isAnnotationInput(value: unknown): value is AnnotationInput {
  return (
    isRecord(value) &&
    typeof value.note === 'string' &&
    typeof value.selector === 'string' &&
    isRecord(value.elementContext) &&
    (value.screenshot === undefined || typeof value.screenshot === 'string')
  );
}

function isAnnotationUpdate(value: unknown): value is AnnotationUpdate {
  if (!isRecord(value)) return false;
  return (
    (value.note === undefined || typeof value.note === 'string') &&
    (value.selector === undefined || typeof value.selector === 'string') &&
    (value.elementContext === undefined || isRecord(value.elementContext)) &&
    (value.screenshot === undefined || typeof value.screenshot === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
