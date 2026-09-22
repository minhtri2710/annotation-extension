export const CAPTURE_TOGGLE_MESSAGE = 'capture.toggle' as const;

export interface CaptureToggleMessage {
  type: typeof CAPTURE_TOGGLE_MESSAGE;
}

export function isCaptureToggleMessage(value: unknown): value is CaptureToggleMessage {
  return isRecord(value) && value.type === CAPTURE_TOGGLE_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
