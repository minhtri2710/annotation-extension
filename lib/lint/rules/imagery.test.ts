// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { imageryRules } from './imagery';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

async function scan(markup: string, style = '', config = {}) {
  document.querySelectorAll('style').forEach((sheet) => sheet.remove());
  document.body.innerHTML = markup;
  if (style) {
    const sheet = document.createElement('style');
    sheet.textContent = style;
    document.head.appendChild(sheet);
  }
  return await collectFindings(imageryRules, createScanContext(window, config), new AbortController().signal);
}

async function ruleFindings(ruleId: string, markup: string, style = '', config = {}) {
  return (await scan(markup, style, config)).filter((finding) => finding.ruleId === ruleId);
}

const SCENE = '<rect fill="red"/><rect fill="blue"/><rect fill="#0f0"/><circle/><circle/><circle/><ellipse/><polygon points="0,0 1,1"/>';

beforeEach(resetDocument);
afterEach(() => vi.restoreAllMocks());

describe('imagery lint rules through the real engine', () => {
  it('exports the four imagery rules in registry order with faithful metadata', () => {
    expect(imageryRules.map((rule) => rule.id)).toEqual([
      'shape-assembled-illustration',
      'organic-clip-path',
      'buried-raster',
      'broken-image',
    ]);
    expect(imageryRules[0]).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Shape-assembled illustration',
      description: 'A large inline SVG that builds a pictorial scene from a pile of primitive shapes reads as placeholder clip art, not illustration. Icons, logos, and data graphics are fine at their scale; a hero-sized visual deserves real artwork, a photograph, or a deliberately drawn graphic.',
      skillSection: 'Imagery',
    });
    expect(imageryRules[1]).toMatchObject({
      category: 'quality',
      name: 'Organic contour drawn as clip-path',
      description: 'A clip-path polygon with many arbitrary vertices, or a curved clip-path path(), is CSS approximating a torn edge, blob, or silhouette. It reads as the cheap version of the effect and is usually a produced or photographic material replaced with code. Derive an alpha matte from the real image, or ship the shape as a cut-out raster; keep clip-path for geometry (cut corners, diagonals, hexagons).',
      skillSection: 'Imagery',
    });
    expect(imageryRules[2]).toMatchObject({
      category: 'quality',
      name: 'Raster buried under a wash or opacity',
      description: 'A background image under a near-opaque gradient wash, or a raster on an element at near-zero opacity, never reaches the screen: the page shows the wash, and the produced texture or photo ships as a compliance token. Let the material show (a tint under 0.9 alpha, a blend mode, an opacity you can see) or remove the file.',
      skillSection: 'Imagery',
    });
    expect(imageryRules[3]).toMatchObject({
      category: 'quality',
      name: 'Broken or placeholder image',
      description: '<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.',
      skillSection: 'Imagery',
    });
    for (const rule of imageryRules.slice(1)) expect(rule.severity).toBeUndefined();
  });

  describe('shape-assembled-illustration', () => {
    it('fires on a large inline svg built from 8 primitives and 3 fills', async () => {
      const findings = await ruleFindings(
        'shape-assembled-illustration',
        `<svg stroke-width="1" viewBox="0 0 400 300">${SCENE}</svg>`,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'advisory',
        advisory: true,
        detail: 'inline <svg> scene: 8 primitive shapes, ~400x300px, 3 fill colors',
      });
      expect(findings[0]!.el?.localName).toBe('svg');
    });

    it('does not fire under the size, primitive, fill, text or pattern thresholds', async () => {
      expect(await ruleFindings('shape-assembled-illustration', `<svg width="199" height="300">${SCENE}</svg>`)).toEqual([]);
      expect(await ruleFindings('shape-assembled-illustration', `<svg viewBox="0 0 400 300">${SCENE.replace('<ellipse/>', '')}</svg>`)).toEqual([]);
      expect(await ruleFindings('shape-assembled-illustration', `<svg viewBox="0 0 400 300">${SCENE.replace('#0f0', 'currentColor')}</svg>`)).toEqual([]);
      expect(await ruleFindings('shape-assembled-illustration', `<svg viewBox="0 0 400 300">${SCENE}<text>a</text><text>b</text><tspan>c</tspan></svg>`)).toEqual([]);
      expect(await ruleFindings('shape-assembled-illustration', `<svg viewBox="0 0 400 300"><defs><pattern id="p"></pattern></defs>${SCENE}</svg>`)).toEqual([]);
    });

    it('keeps stroke-width out of the width lookup (a width attr wins over viewBox)', async () => {
      expect(await ruleFindings('shape-assembled-illustration', `<svg stroke-width="1" width="100" viewBox="0 0 400 300">${SCENE}</svg>`)).toEqual([]);
      expect(await ruleFindings('shape-assembled-illustration', `<svg viewBox="0 0 400 300">${SCENE}<text>a</text><text>b</text></svg>`)).toHaveLength(1);
    });
  });

  describe('organic-clip-path', () => {
    const offGridXs = [3, 11, 17, 33, 41, 58, 63, 81, 88, 96];
    const offGrid = Array.from({ length: 10 }, (_, i) => `${3 + i * 7}.3% ${11 + i * 3}.7%`).join(', ');

    it('fires on a 10-vertex polygon with every coordinate off the 25% grid', async () => {
      const findings = await ruleFindings('organic-clip-path', '<div class="blob"></div>', `.blob { clip-path: polygon(${offGrid}); }`);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'warning',
        detail: 'clip-path: polygon() with 10 vertices approximating an organic contour',
      });
    });

    it('fires once off-grid numbers reach the vertex count, even with on-grid coordinates', async () => {
      const tenOffGrid = offGridXs.map((x) => `${x}% 0%`).join(', ');
      const findings = await ruleFindings('organic-clip-path', '<div></div>', `.a { clip-path: polygon(${tenOffGrid}); }`);
      expect(findings.map((finding) => finding.detail)).toEqual(['clip-path: polygon() with 10 vertices approximating an organic contour']);
    });

    it('fires on a path() with 3 curve commands in an inline style attribute', async () => {
      const findings = await ruleFindings('organic-clip-path', `<div id="p" style="clip-path: path('M0 0 C 1 2 3 4 5 6 S 1 1 2 2 Q 1 1 3 3 Z')"></div>`);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.detail).toBe('clip-path: path() with 3 curve segments');
      expect(findings[0]!.el?.id).toBe('p');
    });

    it('does not fire at 9 vertices, on-grid vertices, or a path with 2 curves', async () => {
      const nine = offGrid.split(', ').slice(0, 9).join(', ');
      const onGrid = Array.from({ length: 10 }, (_, i) => `${(i % 5) * 25}% ${i % 2 ? 50 : 100}%`).join(', ');
      // Rust counts off-grid numbers against the vertex count: 9 off-grid numbers over 10 vertices passes.
      const nineOffGrid = offGridXs.map((x, i) => `${i === 0 ? 25 : x}% 0%`).join(', ');
      expect(await ruleFindings('organic-clip-path', '<div></div>', `.a { clip-path: polygon(${nine}); }`)).toEqual([]);
      expect(await ruleFindings('organic-clip-path', '<div></div>', `.a { clip-path: polygon(${onGrid}); }`)).toEqual([]);
      expect(await ruleFindings('organic-clip-path', '<div></div>', `.a { clip-path: polygon(${nineOffGrid}); }`)).toEqual([]);
      expect(await ruleFindings('organic-clip-path', `<div style="clip-path: path('M0 0 C 1 2 3 4 5 6 Q 1 1 3 3 L 1 1 Z')"></div>`)).toEqual([]);
    });
  });

  describe('buried-raster', () => {
    it('fires on an <img> at computed opacity under 0.15', async () => {
      const findings = await ruleFindings('buried-raster', '<img src="a.png" alt="Hero" style="opacity: 0.1">');
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ detail: '<img> at opacity 0.1 "Hero"' });
      expect(findings[0]!.el?.localName).toBe('img');
    });

    it('fires on a background url at near-zero opacity and labels it with its text', async () => {
      const findings = await ruleFindings('buried-raster', `<div style="opacity: 0; background-image: url('t.png')">Texture</div>`);
      expect(findings.map((finding) => finding.detail)).toEqual(['raster background at opacity 0 "Texture"']);
    });

    it('does not fire at opacity 0.15 or on a non-raster element at low opacity', async () => {
      expect(await ruleFindings('buried-raster', '<img src="a.png" style="opacity: 0.15">')).toEqual([]);
      expect(await ruleFindings('buried-raster', '<div style="opacity: 0.05">text</div>')).toEqual([]);
    });

    it('fires on a url() under a gradient wash whose stops are all at least 0.9 alpha', async () => {
      const findings = await ruleFindings(
        'buried-raster',
        '<section class="hero"></section>',
        '.hero { background: linear-gradient(rgba(0, 0, 0, 0.9), #000000f0), url(photo.jpg); }',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.detail).toBe('raster under a near-opaque gradient wash: linear-gradient(rgba(0, 0, 0, 0.9), #000000f0), url(photo.jpg)');
    });

    it('does not fire on a sub-0.9 tint, a gradient after the url, or a declared blend mode', async () => {
      expect(await ruleFindings('buried-raster', '<p></p>', '.a { background: linear-gradient(rgba(0, 0, 0, 0.89), black), url(p.jpg); }')).toEqual([]);
      expect(await ruleFindings('buried-raster', '<p></p>', '.a { background: url(p.jpg), linear-gradient(black, black); }')).toEqual([]);
      expect(await ruleFindings('buried-raster', '<p></p>', '.a { background: linear-gradient(black, black), url(p.jpg); background-blend-mode: multiply; }')).toEqual([]);
    });
  });

  describe('broken-image', () => {
    it('fires on an <img> with no src, an empty src and a # placeholder', async () => {
      const findings = await ruleFindings('broken-image', '<img alt="a"><img src=""><img src=" # ">');
      expect(findings.map((finding) => finding.detail)).toEqual([
        '<img> with no src attribute',
        '<img src="">',
        '<img src=" # ">',
      ]);
      expect(findings.every((finding) => finding.el?.localName === 'img')).toBe(true);
    });

    it('does not fire on a real src, a fragment src, or a non-img element', async () => {
      expect(await ruleFindings('broken-image', '<img src="a.png"><img src="#hero"><video></video><div src=""></div>')).toEqual([]);
    });
  });
});
