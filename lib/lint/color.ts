export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function parseNumber(value: string): number | undefined {
  const number = Number.parseFloat(value.trim());
  return Number.isFinite(number) ? number : undefined;
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;
  const trimmed = value.trim();
  const number = parseNumber(trimmed);
  if (number === undefined) return 1;
  return clamp(trimmed.endsWith('%') ? number / 100 : number, 0, 1);
}

function parseRgbChannel(value: string): number | undefined {
  const trimmed = value.trim();
  const number = parseNumber(trimmed);
  if (number === undefined) return undefined;
  return clamp(trimmed.endsWith('%') ? (number / 100) * 255 : number, 0, 255);
}

function splitComponents(value: string): string[] {
  return value
    .trim()
    .replaceAll(',', ' ')
    .replace('/', ' / ')
    .split(/\s+/)
    .filter(Boolean);
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgba {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h < 60) [red, green, blue] = [c, x, 0];
  else if (h < 120) [red, green, blue] = [x, c, 0];
  else if (h < 180) [red, green, blue] = [0, c, x];
  else if (h < 240) [red, green, blue] = [0, x, c];
  else if (h < 300) [red, green, blue] = [x, 0, c];
  else [red, green, blue] = [c, 0, x];

  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255),
    a: 1,
  };
}

export function parseColor(css: string): Rgba | undefined {
  const value = css.trim();
  const lower = value.toLowerCase();
  if (!value || lower === 'transparent' || lower === 'none') return undefined;

  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const raw = hex[1];
    if (raw === undefined) return undefined;
    const expanded = raw.length <= 4 ? [...raw].map((part) => part + part).join('') : raw;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }

  const functionMatch = /^(rgba?|hsla?)\((.*)\)$/i.exec(value);
  if (!functionMatch) return undefined;
  const name = functionMatch[1];
  const body = functionMatch[2];
  if (name === undefined || body === undefined) return undefined;
  const parts = splitComponents(body);
  const slash = parts.indexOf('/');
  const values = slash === -1 ? parts : parts.slice(0, slash);
  const alpha = slash === -1 ? parts[3] : parts[slash + 1];

  if (name.toLowerCase().startsWith('rgb')) {
    const red = values[0];
    const green = values[1];
    const blue = values[2];
    if (red === undefined || green === undefined || blue === undefined) return undefined;
    const r = parseRgbChannel(red);
    const g = parseRgbChannel(green);
    const b = parseRgbChannel(blue);
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r, g, b, a: parseAlpha(alpha) };
  }

  const hueValue = values[0];
  const saturationValue = values[1];
  const lightnessValue = values[2];
  if (
    hueValue === undefined ||
    saturationValue === undefined ||
    lightnessValue === undefined ||
    !saturationValue.endsWith('%') ||
    !lightnessValue.endsWith('%')
  ) {
    return undefined;
  }
  const hue = parseNumber(hueValue.replace(/deg$/i, ''));
  const saturation = parseNumber(saturationValue.slice(0, -1));
  const lightness = parseNumber(lightnessValue.slice(0, -1));
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
  const rgb = hslToRgb(hue, clamp(saturation / 100, 0, 1), clamp(lightness / 100, 0, 1));
  rgb.a = parseAlpha(alpha);
  return rgb;
}

function asColor(color: Rgba | string | undefined): Rgba | undefined {
  return typeof color === 'string' ? parseColor(color) : color;
}

export function relativeLuminance(color: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function contrastRatio(
  foreground: Pick<Rgba, 'r' | 'g' | 'b'>,
  background: Pick<Rgba, 'r' | 'g' | 'b'>,
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function hasChroma(color: Rgba | string | undefined, threshold = 30): boolean {
  const parsed = asColor(color);
  if (!parsed) return false;
  return Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b) >= threshold;
}

export function isNeutralColor(color: Rgba | string | undefined): boolean {
  if (color === undefined || color === '' || color === 'transparent') return true;
  if (typeof color === 'string') {
    const value = color.trim().toLowerCase();
    const hsl = /^hsla?\([^,]+,\s*([\d.]+)%/i.exec(value);
    const hslSaturation = hsl?.[1];
    if (hslSaturation !== undefined) return Number.parseFloat(hslSaturation) < 10;
    const oklch = /^oklch\([^\s]+\s+([\d.]+)/i.exec(value);
    const oklchChroma = oklch?.[1];
    if (oklchChroma !== undefined) return Number.parseFloat(oklchChroma) < 0.02;
  }
  const parsed = asColor(color);
  if (!parsed) return false;
  return Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b) < 30;
}

export function isAccentColor(color: Rgba | string | undefined): boolean {
  if (typeof color === 'string') {
    const value = color.trim();
    const hsl = /^hsla?\([^,]+,\s*([\d.]+)%/i.exec(value);
    const hslSaturation = hsl?.[1];
    if (hslSaturation !== undefined) return Number.parseFloat(hslSaturation) >= 20;
    const oklch = /^oklch\([^\s]+\s+([\d.]+)/i.exec(value);
    const oklchChroma = oklch?.[1];
    if (oklchChroma !== undefined) return Number.parseFloat(oklchChroma) >= 0.05;
  }
  return hasChroma(color, 40);
}
