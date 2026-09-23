import { describe, expect, it } from 'vitest';
import { isRecord } from './guards';

describe('isRecord', () => {
  it('accepts plain objects, including empty and null-prototype ones', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ type: 'x' })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it('rejects arrays', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ type: 'x' }])).toBe(false);
  });

  it('rejects null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('rejects primitives, undefined and functions', () => {
    for (const value of [undefined, 0, 1, Number.NaN, '', 'object', true, false, Symbol('s'), 1n, () => ({})]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});
