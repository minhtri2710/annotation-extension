import { parseColor } from './color';

export function parsePx(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^(?:normal|auto|inherit|initial|unset)$/i.test(trimmed)) return undefined;
  const match = /^(-?(?:\d+\.?\d*|\.\d+))px$/i.exec(trimmed);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
}

export function trackingEm(letterSpacingPx: number, fontSizePx: number): number {
  return fontSizePx === 0 ? 0 : letterSpacingPx / fontSizePx;
}

export function cssColorAlpha(css: string): number {
  const value = css.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none') return 0;
  return parseColor(value)?.a ?? 1;
}

export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
