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

function encodeSrgbChannel(value: number): number {
  const clamped = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  const encoded = clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function fromLinearSrgb(red: number, green: number, blue: number): Rgba {
  return {
    r: encodeSrgbChannel(red),
    g: encodeSrgbChannel(green),
    b: encodeSrgbChannel(blue),
    a: 1,
  };
}

// Ported from impeccable's `crates/foundation/src/color.rs` oklab/lab
// conversion routines; the output channels are clamped to sRGB gamut.
function oklabToRgb(lightness: number, a: number, b: number): Rgba {
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return fromLinearSrgb(
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  );
}

function oklchToRgb(lightness: number, chroma: number, hue: number): Rgba {
  const radians = (hue * Math.PI) / 180;
  return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

function labToRgb(lightness: number, a: number, b: number): Rgba {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const invert = (value: number): number => (
    value ** 3 > epsilon ? value ** 3 : (116 * value - 16) / kappa
  );
  const y = lightness > kappa * epsilon
    ? ((lightness + 16) / 116) ** 3
    : lightness / kappa;
  const xn = 0.3457 / 0.3585;
  const zn = (1 - 0.3457 - 0.3585) / 0.3585;
  const x = invert(fx) * xn;
  const z = invert(fz) * zn;
  return fromLinearSrgb(
    3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z,
    -0.978795502912089 * x + 1.916254567259524 * y + 0.0334427311613195 * z,
    0.0719553798841168 * x - 0.2289768264158322 * y + 1.405386058324125 * z,
  );
}

function lchToRgb(lightness: number, chroma: number, hue: number): Rgba {
  const radians = (hue * Math.PI) / 180;
  return labToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

function parseModernNumber(token: string | undefined, percentageScale: number): number | undefined {
  if (token === undefined) return undefined;
  const trimmed = token.trim().toLowerCase();
  if (trimmed === 'none') return 0;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(trimmed)) return undefined;
  const number = Number.parseFloat(trimmed);
  if (!Number.isFinite(number)) return undefined;
  return trimmed.endsWith('%') ? (number / 100) * percentageScale : number;
}

function parseModernHue(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const trimmed = token.trim().toLowerCase();
  if (trimmed === 'none') return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(trimmed);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value)) return undefined;
  switch (match[2]) {
    case 'grad': return value * 0.9;
    case 'rad': return value * (180 / Math.PI);
    case 'turn': return value * 360;
    default: return value;
  }
}

function parseModernAlpha(token: string | undefined): number | undefined {
  if (token === undefined || token.trim().toLowerCase() === 'none') return 1;
  const value = parseModernNumber(token, 1);
  return value === undefined ? undefined : clamp(value, 0, 1);
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

  const modernFunctionMatch = /^(oklch|oklab|lch|lab|color)\((.*)\)$/i.exec(value);
  if (modernFunctionMatch) {
    const name = modernFunctionMatch[1]?.toLowerCase();
    const body = modernFunctionMatch[2];
    if (name === undefined || body === undefined) return undefined;
    const parts = splitComponents(body);
    const slash = parts.indexOf('/');
    const values = slash === -1 ? parts : parts.slice(0, slash);
    const alphaParts = slash === -1 ? [] : parts.slice(slash + 1);
    const alpha = alphaParts[0];
    if (slash !== -1 && alphaParts.length !== 1) return undefined;
    if (alpha !== undefined && values.length === 0) return undefined;

    let rgb: Rgba | undefined;
    if (name === 'oklch' && values.length === 3) {
      const lightness = parseModernNumber(values[0], 1);
      const chroma = parseModernNumber(values[1], 0.4);
      const hue = parseModernHue(values[2]);
      if (lightness !== undefined && chroma !== undefined && hue !== undefined) {
        rgb = oklchToRgb(lightness, chroma, hue);
      }
    } else if (name === 'oklab' && values.length === 3) {
      const lightness = parseModernNumber(values[0], 1);
      const a = parseModernNumber(values[1], 0.4);
      const b = parseModernNumber(values[2], 0.4);
      if (lightness !== undefined && a !== undefined && b !== undefined) {
        rgb = oklabToRgb(lightness, a, b);
      }
    } else if (name === 'lch' && values.length === 3) {
      const lightness = parseModernNumber(values[0], 100);
      const chroma = parseModernNumber(values[1], 150);
      const hue = parseModernHue(values[2]);
      if (lightness !== undefined && chroma !== undefined && hue !== undefined) {
        rgb = lchToRgb(lightness, chroma, hue);
      }
    } else if (name === 'lab' && values.length === 3) {
      const lightness = parseModernNumber(values[0], 100);
      const a = parseModernNumber(values[1], 125);
      const b = parseModernNumber(values[2], 125);
      if (lightness !== undefined && a !== undefined && b !== undefined) {
        rgb = labToRgb(lightness, a, b);
      }
    } else if (name === 'color' && values.length === 4) {
      const space = values[0]?.toLowerCase();
      const red = parseModernNumber(values[1], 1);
      const green = parseModernNumber(values[2], 1);
      const blue = parseModernNumber(values[3], 1);
      if (space === 'srgb' && red !== undefined && green !== undefined && blue !== undefined) {
        rgb = {
          r: Math.round(clamp(red, 0, 1) * 255),
          g: Math.round(clamp(green, 0, 1) * 255),
          b: Math.round(clamp(blue, 0, 1) * 255),
          a: 1,
        };
      }
    }
    if (!rgb) return undefined;
    const parsedAlpha = parseModernAlpha(alpha);
    if (parsedAlpha === undefined) return undefined;
    rgb.a = parsedAlpha;
    return rgb;
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
