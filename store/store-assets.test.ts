import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const SLUGS = ['1-pins', '2-note', '3-scan', '4-list', '5-popup'].map((slug) => `screenshot-${slug}.png`);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICON_BORDER = 16;

const read = (path: string): Buffer => readFileSync(new URL(path, import.meta.url));

function chunks(png: Buffer, type: string): Buffer[] {
  const found: Buffer[] = [];
  for (let offset = SIGNATURE.length; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === type) found.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return found;
}

function decode(png: Buffer, channels: number): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const stride = width * channels;
  const data = inflateSync(Buffer.concat(chunks(png, 'IDAT')));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const raw = data[y * (stride + 1) + 1 + x]!;
      const left = x >= channels ? out[y * stride + x - channels]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels]! : 0;
      const predictor = [
        0,
        left,
        up,
        (left + up) >> 1,
        (() => {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        })(),
      ][filter]!;
      out[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  return out;
}

const EXPECTED = [
  { path: './chrome/icon-128.png', width: 128, height: 128, colorType: 6 },
  { path: './chrome/promo-440x280.png', width: 440, height: 280, colorType: 2 },
  ...SLUGS.map((name) => ({ path: `./chrome/${name}`, width: 1280, height: 800, colorType: 2 })),
  ...SLUGS.map((name) => ({ path: `./firefox/${name}`, width: 1280, height: 800, colorType: 2 })),
];

describe('store listing assets', () => {
  it('holds exactly the listed files per store', () => {
    const dir = (name: string) => readdirSync(new URL(`./${name}/`, import.meta.url)).sort();
    expect(dir('chrome')).toEqual(['icon-128.png', 'promo-440x280.png', ...SLUGS].sort());
    expect(dir('firefox')).toEqual([...SLUGS].sort());
  });

  it.each(EXPECTED)('$path is a $width x $height 8-bit PNG of colour type $colorType', ({ path, width, height, colorType }) => {
    const png = read(path);
    expect(png.subarray(0, 8)).toEqual(SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(colorType);
  });

  it('pads the icon with a fully transparent 16 px border around opaque artwork', () => {
    const pixels = decode(read('./chrome/icon-128.png'), 4);
    const alpha = (x: number, y: number) => pixels[(y * 128 + x) * 4 + 3]!;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const inBorder = x < ICON_BORDER || y < ICON_BORDER || x >= 128 - ICON_BORDER || y >= 128 - ICON_BORDER;
        if (inBorder) expect(alpha(x, y), `pixel ${x},${y}`).toBe(0);
      }
    }
    expect(alpha(64, 64)).toBe(255);
  });
});
