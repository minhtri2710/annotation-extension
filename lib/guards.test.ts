import { describe, expect, it } from 'vitest';
import { errorMessage, isFiniteNumber, isRecord } from './guards';

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

describe('errorMessage', () => {
  it('gives an Error its message and any other value String(value)', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ message: 'not an error' })).toBe('[object Object]');
  });
});

describe('isFiniteNumber', () => {
  it('accepts finite numbers and rejects NaN, Infinity, numeric strings and null', () => {
    expect(isFiniteNumber(1.5)).toBe(true);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      expect(isFiniteNumber(value)).toBe(false);
    }
  });
});
