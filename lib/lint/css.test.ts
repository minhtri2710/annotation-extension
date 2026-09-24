import { describe, expect, it } from 'vitest';
import { cssColorAlpha, parsePx, splitTopLevelCommas, trackingEm } from './css';

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

  it('splits on top-level commas only and drops empty parts', () => {
    expect(splitTopLevelCommas('0 1px rgb(0, 0, 0), , inset 2px 2px (a, (b), c)'))
      .toEqual(['0 1px rgb(0, 0, 0)', 'inset 2px 2px (a, (b), c)']);
  });
});
