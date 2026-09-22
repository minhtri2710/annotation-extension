import { isRecord } from '../guards';

export const CAPTURE_TOGGLE_MESSAGE = 'capture.toggle' as const;

export interface CaptureToggleMessage {
  type: typeof CAPTURE_TOGGLE_MESSAGE;
}

export function isCaptureToggleMessage(value: unknown): value is CaptureToggleMessage {
  return isRecord(value) && value.type === CAPTURE_TOGGLE_MESSAGE;
}
