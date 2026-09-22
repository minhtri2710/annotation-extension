import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hasChroma,
  isAccentColor,
  isNeutralColor,
  parseColor,
  relativeLuminance,
} from './color';

describe('lint color math', () => {
  it('computes WCAG luminance and contrast', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };

    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 10);
  });

  it('parses hex, rgb, rgba, hsl, and transparent values', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('#abcd')).toEqual({ r: 170, g: 187, b: 204, a: 0.8666666666666667 });
    expect(parseColor('#112233')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
    expect(parseColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 / 255 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('transparent')).toBeUndefined();
    expect(parseColor('none')).toBeUndefined();
    expect(parseColor('red')).toBeUndefined();
  });

  it('uses impeccable chroma, neutral, and accent thresholds', () => {
    const gray = parseColor('#777')!;
    const saturated = parseColor('#ff0066')!;

    expect(hasChroma(gray, 30)).toBe(false);
    expect(hasChroma(saturated, 30)).toBe(true);
    expect(isNeutralColor(gray)).toBe(true);
    expect(isNeutralColor(saturated)).toBe(false);
    expect(isAccentColor(gray)).toBe(false);
    expect(isAccentColor(saturated)).toBe(true);
    expect(isAccentColor('hsl(120, 20%, 50%)')).toBe(true);
  });
});
