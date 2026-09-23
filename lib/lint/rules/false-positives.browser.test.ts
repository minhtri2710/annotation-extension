import { afterEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext, type Finding, type Rule } from '../engine';
import { revealSweep } from '../../scan-panel/reveal-sweep';
import { hiddenAtRestRules } from './hidden-at-rest';
import { motionRules } from './motion';
import { visualDetailsRules } from './visual-details';

const page = (css: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{margin:0;font:16px/1.5 system-ui,sans-serif}${css}</style></head><body>${body}</body></html>`;

let frame: HTMLIFrameElement | undefined;

async function load(html: string): Promise<Window> {
  frame = document.createElement('iframe');
  frame.style.cssText = 'width:1280px;height:800px;border:0;position:fixed;top:0;left:0';
  document.body.append(frame);
  await new Promise<void>((resolve) => {
    frame!.onload = () => resolve();
    frame!.srcdoc = html;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return frame.contentWindow!;
}

async function findings(win: Window, rules: Rule[], ruleId: string): Promise<Finding[]> {
  return (await collectFindings(rules, createScanContext(win), new AbortController().signal)).filter((finding) => finding.ruleId === ruleId);
}

async function hiddenAtRest(win: Window): Promise<Finding[]> {
  await revealSweep(win, new AbortController().signal);
  return findings(win, hiddenAtRestRules, 'content-hidden-at-rest');
}

afterEach(() => {
  frame?.remove();
  frame = undefined;
});

describe('content-hidden-at-rest in a real browser after the reveal sweep', () => {
  it('does not fire on a visibility-hidden mega menu', async () => {
    const menu = Array.from({ length: 6 }, (_, i) => `<a href="#">Products link ${i + 1} with a descriptive label</a><p>Short description of products item ${i + 1} for scanning.</p>`).join('');
    const win = await load(page(
      'nav li{position:relative;list-style:none}.menu{position:absolute;top:100%;left:0;width:600px;visibility:hidden;opacity:0}nav li:hover .menu,nav li:focus-within .menu{visibility:visible;opacity:1}',
      `<nav><ul>${['Products', 'Solutions', 'Resources'].map((name) => `<li><a href="#">${name}</a><div class="menu">${menu}</div></li>`).join('')}</ul></nav><h1>Welcome</h1><p>A short landing page.</p>`,
    ));
    expect(await hiddenAtRest(win)).toEqual([]);
  });

  it('does not fire on a visibility-hidden accordion', async () => {
    const items = Array.from({ length: 6 }, (_, i) => `<div class="item"><h2><button aria-expanded="false" aria-controls="p${i}">Question ${i + 1}: how does feature ${i + 1} work?</button></h2><div class="panel" id="p${i}"><div><p>Feature ${i + 1} works by reading your settings, applying the rules you set up, and saving the result so you can review it later in the history view.</p></div></div></div>`).join('');
    const win = await load(page(
      '.panel{display:grid;grid-template-rows:0fr;visibility:hidden}.panel>div{overflow:hidden}.item.open .panel{grid-template-rows:1fr;visibility:visible}',
      `<main><h1>FAQ</h1><p>Answers to common questions.</p>${items}</main>`,
    ));
    expect(await hiddenAtRest(win)).toEqual([]);
  });

  it('still fires on a reveal page whose content stays at opacity 0', async () => {
    const sections = Array.from({ length: 8 }, (_, i) => `<section class="reveal"><h2>Chapter ${i + 1}</h2><p>Chapter ${i + 1} tells part of the story with enough words to count as body text.</p></section>`).join('');
    const win = await load(page('section{min-height:90vh}.reveal{opacity:0}', sections));
    const hits = await hiddenAtRest(win);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.detail).toMatch(/^100% of page text/);
  });
});

describe('pulsing-dot reduced-motion guard in a real browser', () => {
  const dot = '<h1>Status</h1><p><span class="dot" aria-hidden="true"></span>All systems operational</p>';
  const base = '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a}@keyframes pulse{50%{opacity:.4}}';

  it('fires on an unguarded pulsing dot', async () => {
    const win = await load(page(`${base}.dot{animation:pulse 2s ease-in-out infinite}`, dot));
    const hits = await findings(win, motionRules, 'pulsing-dot');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('.dot'));
  });

  it('does not fire when the animation only applies under prefers-reduced-motion no-preference', async () => {
    const win = await load(page(`${base}@media (prefers-reduced-motion:no-preference){.dot{animation:pulse 2s ease-in-out infinite}}`, dot));
    expect(win.getComputedStyle(win.document.querySelector('.dot')!).animationName).toBe('pulse');
    expect(await findings(win, motionRules, 'pulsing-dot')).toEqual([]);
  });

  it('does not fire when a prefers-reduced-motion reduce rule sets the animation shorthand to none', async () => {
    const win = await load(page(`${base}.dot{animation:pulse 2s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.dot{animation:none}}`, dot));
    expect(await findings(win, motionRules, 'pulsing-dot')).toEqual([]);
  });
});

describe('repeating-stripes-gradient in a real browser', () => {
  const stripes = '.fill{height:16px;width:60%;background-color:#2563eb;background-image:repeating-linear-gradient(45deg,rgb(255 255 255 / .15) 0 10px,transparent 10px 20px)}';

  it('anchors the hit to the striped progress fill', async () => {
    const win = await load(page(stripes, '<div role="progressbar" aria-valuenow="60" aria-label="Upload progress"><div class="fill"></div></div>'));
    const hits = await findings(win, visualDetailsRules, 'repeating-stripes-gradient');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('.fill'));
    expect(hits[0]).toMatchObject({ severity: 'advisory', detail: 'repeating-gradient decorative stripes' });
  });

  it('does not fire for a stripe rule that matches no element', async () => {
    const win = await load(page(stripes, '<div role="progressbar" aria-label="Upload progress"><div class="bar"></div></div>'));
    expect(await findings(win, visualDetailsRules, 'repeating-stripes-gradient')).toEqual([]);
  });
});
