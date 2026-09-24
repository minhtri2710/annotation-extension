import { isRecord } from '../guards';

export const CAPTURE_TOGGLE_MESSAGE = 'capture.toggle' as const;

export interface CaptureToggleMessage {
  type: typeof CAPTURE_TOGGLE_MESSAGE;
}

export function isCaptureToggleMessage(value: unknown): value is CaptureToggleMessage {
  return isRecord(value) && value.type === CAPTURE_TOGGLE_MESSAGE;
}

export const CAPTURE_STATE_MESSAGE = 'capture.state' as const;

export interface CaptureStateMessage {
  type: typeof CAPTURE_STATE_MESSAGE;
}

export function isCaptureStateMessage(value: unknown): value is CaptureStateMessage {
  return isRecord(value) && value.type === CAPTURE_STATE_MESSAGE;
}
