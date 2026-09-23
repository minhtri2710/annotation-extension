// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { colorRules } from './color';

function resetDocument(): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
}

function findings(): ReturnType<typeof collectFindings> {
  return collectFindings(colorRules, createScanContext(window));
}

function hasRule(ruleId: string): boolean {
  return findings().some((finding) => finding.ruleId === ruleId);
}

function ruleFindings(ruleId: string): ReturnType<typeof collectFindings> {
  return findings().filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

beforeEach(resetDocument);

describe('color lint rules through the real engine', () => {
  it('does not report white text on an oklch blue background', () => {
    document.body.innerHTML = '<div id="blue" style="color: white; background-color: oklch(55% 0.2 250); font-size: 16px">Blue</div>';
    const ctx = createScanContext(window);
    const baseStyle = ctx.style;
    ctx.style = (el, pseudo) => {
      const style = baseStyle(el, pseudo);
      if (el.id !== 'blue') return style;
      return {
        getPropertyValue: (property: string) => {
          if (property === 'color') return 'rgb(255, 255, 255)';
          if (property === 'background-color' || property === 'backgroundColor') return 'oklch(55% 0.2 250)';
          return style.getPropertyValue(property);
        },
      } as CSSStyleDeclaration;
    };

    const result = collectFindings(colorRules, ctx);
    expect(result.some((finding) => finding.ruleId === 'low-contrast' && finding.el === document.querySelector('#blue'))).toBe(false);
  });

  it('treats an unparseable present background as unresolved', () => {
    document.body.innerHTML = '<div id="unresolved" style="color: white; background-color: oklch(broken); font-size: 16px">Unresolved</div>';
    const ctx = createScanContext(window);
    const baseStyle = ctx.style;
    ctx.style = (el, pseudo) => {
      const style = baseStyle(el, pseudo);
      if (el.id !== 'unresolved') return style;
      return {
        getPropertyValue: (property: string) => {
          if (property === 'color') return 'rgb(255, 255, 255)';
          if (property === 'background-color' || property === 'backgroundColor') return 'oklch(broken)';
          return style.getPropertyValue(property);
        },
      } as CSSStyleDeclaration;
    };

    const result = collectFindings(colorRules, ctx);
    expect(result.some((finding) => finding.ruleId === 'low-contrast' && finding.el === document.querySelector('#unresolved'))).toBe(false);
  });

  it('flags low contrast and skips an unresolved gradient background', () => {
    document.body.innerHTML = `
      <p id="low" style="color: rgb(119, 119, 119); background-color: rgb(255, 255, 255); font-size: 16px">Low</p>
      <p id="gradient" style="color: rgb(119, 119, 119); background-image: url(background.png), linear-gradient(rgb(255, 255, 255), rgb(240, 240, 240)); background-color: transparent; font-size: 16px">Gradient</p>
    `;

    const hit = ruleFindings('low-contrast');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toContain('need 4.5:1');
    expect(first(hit).el).toBe(document.querySelector('#low'));
    expect(ruleFindings('low-contrast').some((finding) => finding.el === document.querySelector('#gradient'))).toBe(false);

    document.querySelector('#low')!.setAttribute(
      'style',
      'color: rgb(118, 118, 118); background-color: rgb(255, 255, 255); font-size: 16px',
    );
    expect(hasRule('low-contrast')).toBe(false);
  });

  it('flags gray ink on a chromatic background but not below the chroma boundary', () => {
    document.body.innerHTML = `
      <p id="positive" style="color: rgb(119, 119, 119)">Positive</p>
      <p id="negative" style="color: rgb(119, 119, 119)">Negative</p>
    `;
    (document.querySelector('#positive')!.parentElement as HTMLElement).style.backgroundColor = 'rgb(100, 100, 140)';
    (document.querySelector('#negative') as HTMLElement).style.backgroundColor = 'rgb(100, 100, 138)';

    expect(ruleFindings('gray-on-color')).toHaveLength(1);
    expect(first(ruleFindings('gray-on-color')).el).toBe(document.querySelector('#positive'));
    expect(first(ruleFindings('gray-on-color')).detail).toContain('text #777777');
    expect(ruleFindings('gray-on-color').some((finding) => finding.el === document.querySelector('#negative'))).toBe(false);
  });

  it('flags clipped gradient text and not a clipped solid background', () => {
    document.body.innerHTML = `
      <h1 id="positive" style="color: transparent; background-image: linear-gradient(rgb(124, 58, 237), rgb(236, 72, 153)); background-clip: text">Gradient</h1>
      <h1 id="negative" style="color: transparent; background-image: none; background-clip: text">Solid</h1>
    `;

    const hit = ruleFindings('gradient-text');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toBe('background-clip: text + gradient');
    expect(first(hit).el).toBe(document.querySelector('#positive'));
  });

  it('flags a warm cream page background and not a neutral near-threshold surface', () => {
    document.body.style.backgroundColor = 'rgb(245, 239, 227)';
    expect(ruleFindings('cream-palette')).toHaveLength(1);
    expect(first(ruleFindings('cream-palette')).detail).toContain('rgb(245, 239, 227)');
    expect(first(ruleFindings('cream-palette')).el).toBeUndefined();

    document.body.style.backgroundColor = 'rgb(245, 245, 245)';
    expect(hasRule('cream-palette')).toBe(false);
  });

  it('flags a purple gradient palette and not a gradient below the chroma threshold', () => {
    document.body.innerHTML = `
      <div id="positive" style="background-image: linear-gradient(rgb(124, 58, 237), rgb(59, 130, 246))"></div>
      <div id="negative" style="background-image: linear-gradient(rgb(124, 75, 124), rgb(100, 100, 100))"></div>
    `;

    const hit = ruleFindings('ai-color-palette');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toBe('Purple/violet gradient background');
    expect(first(hit).el).toBe(document.querySelector('#positive'));
  });

  it('fails closed for nested colors in color-mix and parses plain shadow colors', () => {
    document.body.innerHTML = '<div id="mix"></div><div id="relative"></div><div id="shadow"></div>';
    const ctx = createScanContext(window);
    const baseStyle = ctx.style;
    const values: Record<string, Record<string, string>> = {
      mix: { backgroundImage: 'linear-gradient(color-mix(in srgb, rgb(124 58 237) 50%, white), transparent)' },
      relative: { backgroundImage: 'linear-gradient(oklch(from blue l c h), white)' },
      shadow: { boxShadow: 'rgb(255 0 0) 0 0 20px, rgb(0 0 255) 0 0 20px' },
    };
    ctx.style = (el, pseudo) => {
      const style = baseStyle(el, pseudo);
      const overrides = values[el.id];
      return {
        getPropertyValue: (property: string) => overrides?.[property] ?? style.getPropertyValue(property),
      } as CSSStyleDeclaration;
    };
    const result = collectFindings(colorRules, ctx);

    expect(result.filter((finding) => finding.ruleId === 'ai-color-palette')).toHaveLength(0);
    const glow = result.filter((finding) => finding.ruleId === 'dark-glow');
    expect(glow).toHaveLength(1);
    expect(first(glow).detail).toBe('Zero-offset box-shadow glow (#ff0000)');
  });

  it('reads colors from every top-level gradient layer', () => {
    document.body.innerHTML = '<div id="low">Low</div><div id="purple"></div>';
    const ctx = createScanContext(window);
    const baseStyle = ctx.style;
    const values: Record<string, Record<string, string>> = {
      low: {
        color: 'rgb(119, 119, 119)',
        backgroundColor: 'transparent',
        backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0)), linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255))',
        fontSize: '16px',
      },
      purple: {
        backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0)), linear-gradient(rgb(124, 58, 237), rgb(59, 130, 246))',
      },
    };
    ctx.style = (el, pseudo) => {
      const style = baseStyle(el, pseudo);
      const overrides = values[el.id];
      return {
        getPropertyValue: (property: string) => overrides?.[property] ?? style.getPropertyValue(property),
      } as CSSStyleDeclaration;
    };
    const result = collectFindings(colorRules, ctx);

    expect(result.some((finding) => finding.ruleId === 'low-contrast' && finding.el === document.querySelector('#low'))).toBe(true);
    expect(result.some((finding) => finding.ruleId === 'ai-color-palette' && finding.el === document.querySelector('#purple'))).toBe(true);
  });

  it('flags a chromatic zero-offset glow and not a blur at the threshold', () => {
    document.body.innerHTML = `
      <div id="positive" style="box-shadow: rgb(59, 130, 246) 0px 0px 20px 0px"></div>
      <div id="negative" style="box-shadow: rgb(59, 130, 246) 0px 0px 4px 0px"></div>
    `;

    const hit = ruleFindings('dark-glow');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toBe('Zero-offset box-shadow glow (#3b82f6)');
    expect(first(hit).el).toBe(document.querySelector('#positive'));
  });

  it('flags a dark-page radial halo and not a low-alpha halo', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    document.body.innerHTML = `
      <div id="positive" style="background-image: radial-gradient(circle, rgb(255, 0, 0) 60%, transparent 100%)"></div>
      <div id="negative" style="background-image: radial-gradient(circle, rgba(255, 0, 0, 0.69) 60%, transparent 100%)"></div>
    `;

    const hit = ruleFindings('radial-halo');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toBe('radial-gradient halo (#ff0000 → transparent) on dark page');
    expect(first(hit).el).toBe(document.querySelector('#positive'));
  });

  it('flags a soft radial spotlight on a large surface and not an opaque stop', () => {
    document.body.innerHTML = `
      <section id="positive" class="hero" style="width: 800px; height: 400px; background-image: radial-gradient(circle at 52% 38%, rgba(80, 111, 255, 0.26), transparent 44%)"></section>
      <section id="negative" style="width: 800px; height: 400px; background-image: radial-gradient(circle, rgba(80, 111, 255, 0.45), transparent 44%)"></section>
    `;

    const hit = ruleFindings('radial-spotlight-glow');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toContain('"hero"');
    expect(first(hit).detail).toContain('800x400');
    expect(first(hit).el).toBe(document.querySelector('#positive'));
  });

  it('keeps design-system colors inert without config and flags an undeclared color with config', () => {
    document.body.innerHTML = '<p id="target" style="color: rgb(0, 255, 0)">Target</p>';
    expect(hasRule('design-system-color')).toBe(false);

    const ctx = createScanContext(window, { designSystem: { colors: ['#ff0000'] } });
    const hit = collectFindings(colorRules, ctx).filter((finding) => finding.ruleId === 'design-system-color');
    expect(hit).toHaveLength(1);
    expect(first(hit).detail).toContain('text color rgb(0, 255, 0)');
    expect(first(hit).ignoreValue).toBe('rgb(0, 255, 0)');
    expect(first(hit).severity).toBe('advisory');

    document.querySelector('#target')!.setAttribute('style', 'color: rgb(255, 0, 0)');
    expect(collectFindings(colorRules, createScanContext(window, {
      designSystem: { colors: ['#ff0000'] },
    })).some((finding) => finding.ruleId === 'design-system-color')).toBe(false);
  });
});
