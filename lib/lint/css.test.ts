import { describe, expect, it } from 'vitest';
import { cssColorAlpha, parsePx, trackingEm } from './css';

describe('lint CSS measurements', () => {
  it('parses pixel lengths and ignores non-length values', () => {
    expect(parsePx('12px')).toBe(12);
    expect(parsePx('normal')).toBeUndefined();
    expect(parsePx(' auto ')).toBeUndefined();
  });

  it('computes relative tracking', () => {
    expect(trackingEm(0.5, 10)).toBe(0.05);
  });

  it('reads CSS color alpha', () => {
    expect(cssColorAlpha('rgba(0,0,0,0.5)')).toBe(0.5);
    expect(cssColorAlpha('transparent')).toBe(0);
  });
});
