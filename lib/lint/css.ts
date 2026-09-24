import { parseColor } from './color';

export function parsePx(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^(?:normal|auto|inherit|initial|unset)$/i.test(trimmed)) return undefined;
  const match = /^(-?(?:\d+\.?\d*|\.\d+))px$/i.exec(trimmed);
  if (!match) return undefined;
  const capturedNumber = match[1];
  if (capturedNumber === undefined) return undefined;
  const number = Number.parseFloat(capturedNumber);
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

export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}
