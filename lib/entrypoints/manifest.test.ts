import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';
import type { UserManifest } from 'wxt';

describe('manifest permissions', () => {
  it('requests only storage and activeTab', () => {
    expect((config.manifest as UserManifest).permissions).toEqual(['storage', 'activeTab']);
  });
});

describe('manifest firefox settings', () => {
  it('declares the gecko id, no data collection and the first Firefox that reads it', () => {
    expect((config.manifest as UserManifest).browser_specific_settings).toEqual({
      gecko: {
        id: 'annotation-extension@minhtri2710',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    });
  });
});

describe('package scripts', () => {
  it('zips the Chrome build and the Firefox build', () => {
    const { scripts } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(scripts.zip).toBe('wxt zip');
    expect(scripts['zip:firefox']).toBe('wxt zip -b firefox');
  });
});

describe('sources zip', () => {
  it('leaves out the untracked task-manager files', () => {
    expect(config.zip?.excludeSources).toEqual(
      expect.arrayContaining(['backlog.md', 'done-archive.md']),
    );
  });
});

const ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  128: 'icon/128.png',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readIcon(path: string): Buffer {
  return readFileSync(new URL(`../../public/${path}`, import.meta.url));
}

function idatData(png: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let offset = PNG_SIGNATURE.length; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') {
      parts.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  return Buffer.concat(parts);
}

describe('manifest icons', () => {
  it('declares the icon map for the extension and the toolbar button', () => {
    const manifest = config.manifest as UserManifest;
    expect(manifest.icons).toEqual(ICONS);
    expect(manifest.action?.default_icon).toEqual(ICONS);
  });

  it.each(Object.entries(ICONS))('%s is an RGBA PNG of that size', (size, path) => {
    const png = readIcon(path);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(Number(size));
    expect(png.readUInt32BE(20)).toBe(Number(size));
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
  });

  it.each(Object.entries(ICONS))('%s has a transparent top-left corner', (_size, path) => {
    // Pixel (0, 0) leads the first scanline after its filter byte, and every PNG filter type
    // leaves the first pixel's raw bytes unchanged, so no unfiltering is needed.
    // Byte 4 is alpha only for colour type 6; an opaque RGB image has no alpha channel.
    const png = readIcon(path);
    expect(png[25]).toBe(6);
    expect(inflateSync(idatData(png))[4]).toBe(0);
  });
});
