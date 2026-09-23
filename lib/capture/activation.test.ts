import { describe, expect, it } from 'vitest';
import { CAPTURE_TOGGLE_MESSAGE, isCaptureToggleMessage } from './activation';

describe('isCaptureToggleMessage', () => {
  it('accepts the toggle message, with or without extra fields', () => {
    expect(CAPTURE_TOGGLE_MESSAGE).toBe('capture.toggle');
    expect(isCaptureToggleMessage({ type: 'capture.toggle' })).toBe(true);
    expect(isCaptureToggleMessage({ type: 'capture.toggle', extra: 1 })).toBe(true);
  });

  it('rejects other message types and a missing type', () => {
    expect(isCaptureToggleMessage({ type: 'capture.start' })).toBe(false);
    expect(isCaptureToggleMessage({ type: 'Capture.Toggle' })).toBe(false);
    expect(isCaptureToggleMessage({})).toBe(false);
  });

  it('rejects arrays, null and non-objects', () => {
    const toggleArray = Object.assign(['capture.toggle'], { type: 'capture.toggle' });
    expect(isCaptureToggleMessage(toggleArray)).toBe(false);
    expect(isCaptureToggleMessage(null)).toBe(false);
    for (const value of [undefined, 'capture.toggle', 0, true]) {
      expect(isCaptureToggleMessage(value)).toBe(false);
    }
  });
});
