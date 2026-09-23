import { afterEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext, type Finding, type Rule } from '../engine';
import { revealSweep } from '../../scan-panel/reveal-sweep';
import { colorRules } from './color';
import { imageryRules } from './imagery';
import { hiddenAtRestRules } from './hidden-at-rest';
import { liveStateRules } from './live-state';
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

  it('reports one hit with a count for rows sharing one stripe value', async () => {
    const win = await load(page(stripes, Array.from({ length: 3 }, () => '<div role="progressbar" aria-label="Upload progress"><div class="fill"></div></div>').join('')));
    const hits = await findings(win, visualDetailsRules, 'repeating-stripes-gradient');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('.fill'));
    expect(hits[0]!.detail).toBe('repeating-gradient decorative stripes (3 elements)');
  });

  it('does not fire for a stripe rule that matches no element', async () => {
    const win = await load(page(stripes, '<div role="progressbar" aria-label="Upload progress"><div class="bar"></div></div>'));
    expect(await findings(win, visualDetailsRules, 'repeating-stripes-gradient')).toEqual([]);
  });
});

describe('inactive, truncated and snapping UI in a real browser', () => {
  it('skips low-contrast on a disabled button and still flags the same colors when enabled', async () => {
    const css = 'button{font:16px system-ui;padding:8px 16px;border:0;color:#a0a0a0;background:#f0f0f0}';
    const win = await load(page(css, '<button id="off" disabled>Save</button><div aria-disabled="true"><button>Aria</button></div><button id="on">Send</button>'));
    const hits = await findings(win, colorRules, 'low-contrast');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('#on'));
  });

  it('skips text-overflow on ellipsis truncation and still flags an unclipped overflow', async () => {
    const long = 'A very long list item title that cannot fit in the narrow column at all';
    const win = await load(page(
      'ul{width:200px;padding:0}li{white-space:nowrap}.cut{overflow:hidden;text-overflow:ellipsis}',
      `<ul><li class="cut" title="${long}">${long}</li><li class="cut">${long}</li><li id="spill">${long}</li></ul>`,
    ));
    const hits = await findings(win, liveStateRules, 'text-overflow');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('#spill'));
  });

  it('skips edge-flush-cards on a scroll-snap carousel rail and still flags the same rail without snapping', async () => {
    const cards = Array.from({ length: 8 }, (_, i) => `<article>Card ${i + 1}</article>`).join('');
    const css = (snap: string) => `.rail{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:${snap};width:900px;height:240px}article{flex:0 0 300px;height:200px;background:#fff;border:1px solid #ccc;scroll-snap-align:start}`;
    const snapped = await load(page(css('x mandatory'), `<div class="rail">${cards}</div>`));
    expect(await findings(snapped, liveStateRules, 'edge-flush-cards')).toEqual([]);
    frame!.remove();
    const plain = await load(page(css('none'), `<div class="rail">${cards}</div>`));
    const hits = await findings(plain, liveStateRules, 'edge-flush-cards');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(plain.document.querySelector('.rail'));
  });
});

describe('text-occlusion on floating labels in a real browser', () => {
  const field = (input: string) => page(
    `.field{position:relative;width:320px;margin:40px}.field input{display:block;box-sizing:border-box;width:100%;height:56px;border:1px solid #666;border-radius:4px;background:transparent;font:16px system-ui;padding:24px 12px 6px${input}}.field label{position:absolute;left:12px;top:6px;font-size:12px;color:#333;pointer-events:none}`,
    '<div class="field"><input id="dest"><label for="dest">Destination</label></div>',
  );

  it('skips a pointer-events:none label painted above its input', async () => {
    const win = await load(field(''));
    expect(await findings(win, liveStateRules, 'text-occlusion')).toEqual([]);
  });

  it('still flags the same label when the input paints over it', async () => {
    const win = await load(field(';position:relative;z-index:1;background:#fff'));
    const hits = await findings(win, liveStateRules, 'text-occlusion');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('label'));
    expect(hits[0]!.detail).toContain('covered by an opaque element (input)');
  });

  const covers: Array<[string, string, string, string]> = [
    ['a transform', '', ';transform:translateZ(0)', ''],
    ['opacity below 1', '', ';opacity:0.99', ''],
    ['will-change on a wrapper', '', '', 'will-change:transform'],
    ['a filter', '', ';filter:blur(0)', ''],
    ['isolation', '', ';isolation:isolate', ''],
    ['contain:paint', '', ';contain:paint', ''],
    ['a flex-item z-index:1', '.field{display:flex;flex-direction:column}', ';z-index:1', ''],
    ['position:relative;z-index:1', '', ';position:relative;z-index:1', ''],
    ['no stacking trigger', '', '', ''],
  ];
  const orders = ['label before input', 'label after input'] as const;

  it.each(orders.flatMap((order) => covers.map(([name, fieldCss, input, wrapper]) => [name, order, fieldCss, input, wrapper] as const)))(
    'reports the label exactly when the browser paints the input with %s over it (%s)',
    async (_name, order, fieldCss, input, wrapper) => {
      const html = (labelCss: string) => {
        const inputHtml = wrapper ? `<div style="${wrapper}"><input id="dest"></div>` : '<input id="dest">';
        const labelHtml = '<label for="dest">Destination</label>';
        return field(`${input};background:#fff`)
          .replace('</style>', `${fieldCss}.field label{${labelCss}}</style>`)
          .replace('<input id="dest"><label for="dest">Destination</label>', order === 'label before input' ? labelHtml + inputHtml : inputHtml + labelHtml);
      };
      const truthWin = await load(html('pointer-events:auto'));
      const truthLabel = truthWin.document.querySelector('label')!;
      const rect = truthLabel.getBoundingClientRect();
      const covered = truthWin.document.elementFromPoint(rect.left + 5, rect.top + rect.height / 2) !== truthLabel;
      frame!.remove();

      const win = await load(html(''));
      const hits = await findings(win, liveStateRules, 'text-occlusion');
      if (covered) {
        expect(hits).toHaveLength(1);
        expect(hits[0]!.el).toBe(win.document.querySelector('label'));
        expect(hits[0]!.detail).toContain('covered by an opaque element (input)');
      } else {
        expect(hits).toEqual([]);
      }
    },
  );

  // A cover outside the field, overlapping the label; the truth page is the same page with a
  // hit-testable label.
  const outside = (css: string, body: string) => (labelCss: string) => page(
    `.field{position:relative;width:300px}.field input{display:block;box-sizing:border-box;width:100%;height:56px;padding-top:24px}.field label{position:absolute;left:12px;top:6px;font-size:14px;color:#333;pointer-events:none}.cover{background:#fff;width:300px;height:60px}${css}.field label{${labelCss}}`,
    body,
  );
  const outsideField = '<div class="field"><input id="dest"><label for="dest">Destination</label></div>';

  async function expectOccludedExactlyWhenPainted(html: (labelCss: string) => string, expected?: boolean) {
    const truthWin = await load(html('pointer-events:auto'));
    const truthLabel = truthWin.document.querySelector('label')!;
    const rect = truthLabel.getBoundingClientRect();
    const coverRect = truthWin.document.querySelector('.cover')!.getBoundingClientRect();
    expect(coverRect.left <= rect.left && coverRect.right >= rect.right && coverRect.top <= rect.top && coverRect.bottom >= rect.bottom).toBe(true);
    const covered = truthWin.document.elementFromPoint(rect.left + 5, rect.top + rect.height / 2) !== truthLabel;
    if (expected !== undefined) expect(covered).toBe(expected);
    frame!.remove();

    const win = await load(html(''));
    const hits = await findings(win, liveStateRules, 'text-occlusion');
    if (covered) {
      expect(hits).toHaveLength(1);
      expect(hits[0]!.el).toBe(win.document.querySelector('label'));
      expect(hits[0]!.detail).toContain('covered by an opaque element (div.cover)');
    } else {
      expect(hits).toEqual([]);
    }
  }

  it('reports a z-indexed dropdown in a z-auto positioned wrapper painted over a later label', async () => {
    await expectOccludedExactlyWhenPainted(outside('', `<div style="position:relative;height:0"><div class="cover" style="position:absolute;top:0;z-index:1000">menu</div></div>${outsideField}`), true);
  });

  it('skips a z-indexed label in a z-auto positioned field under a later lower-z cover', async () => {
    await expectOccludedExactlyWhenPainted(outside('.field label{z-index:10}', `${outsideField}<div class="cover" style="position:relative;top:-56px;z-index:5"></div>`), false);
  });

  it('reports a z-indexed dropdown in a will-change:scroll-position wrapper painted over a later label', async () => {
    await expectOccludedExactlyWhenPainted(outside('', `<div style="will-change:scroll-position;height:0"><div class="cover" style="position:absolute;z-index:1000"></div></div>${outsideField}`), true);
  });

  it.each(['will-change:scroll-position', 'will-change:contents', 'will-change:transform', 'will-change:opacity', 'will-change:scroll-position, transform', 'contain:inline-size', 'contain:paint'])(
    'reports the label exactly when the browser paints a z-indexed dropdown in a %s wrapper over it',
    async (wrapper) => {
      await expectOccludedExactlyWhenPainted(outside('', `<div style="${wrapper};height:0"><div class="cover" style="position:absolute;z-index:1000"></div></div>${outsideField}`));
    },
  );

  const wrappers = [['no wrapper', ''], ['a position:relative wrapper', 'position:relative'], ['a position:relative;z-index:1 wrapper', 'position:relative;z-index:1'], ['a transform wrapper', 'transform:translateZ(0)']] as const;
  const coverStyles = [['plain', ''], ['position:absolute;z-index:1000', 'position:absolute;z-index:1000'], ['position:relative', 'position:relative'], ['opacity:0.99', 'opacity:0.99']] as const;
  const labelZ = [['auto', 'auto'], ['10', '10']] as const;
  const coverOrders = ['cover before field', 'cover after field'] as const;
  const matrix = wrappers.flatMap(([wrapperName, wrapper]) => coverStyles.flatMap(([coverName, cover]) => labelZ.flatMap(([zName, z]) => coverOrders.map((order) => [wrapperName, coverName, zName, order, wrapper, cover, z] as const))));

  it.each(matrix)(
    'reports the label exactly when the browser paints an outside cover over it: %s, %s cover, label z-index %s, %s',
    async (_wrapperName, _coverName, _zName, order, wrapper, cover, z) => {
      const after = order === 'cover after field';
      const coverHtml = wrapper
        ? `<div style="${wrapper};height:0${after ? ';margin-top:-56px' : ''}"><div class="cover" style="${cover}"></div></div>`
        : `<div class="cover" style="${cover};${after ? 'margin-top:-56px' : 'margin-bottom:-60px'}"></div>`;
      await expectOccludedExactlyWhenPainted(outside(`.field label{z-index:${z}}`, after ? outsideField + coverHtml : coverHtml + outsideField));
    },
  );
});

describe('first-viewport-column-overflow on sidebar layouts at tablet width in a real browser', () => {
  const links = Array.from({ length: 6 }, (_, i) => `<a href="#" style="display:block">Guide ${i + 1}</a>`).join('');
  const article = Array.from({ length: 14 }, (_, i) => `<p>Paragraph ${i + 1} of the documentation explains one step of the setup in enough detail to follow along without guessing what comes next.</p>`).join('');
  const layout = (side: string, content: string) => page(
    '.layout{display:grid;grid-template-columns:260px 1fr;gap:24px}.content,main{min-width:0}',
    `<div class="layout">${side}${content}</div>`,
  );

  async function atTablet(html: string): Promise<Window> {
    const win = await load(html);
    frame!.style.width = '768px';
    await new Promise((resolve) => setTimeout(resolve, 100));
    return win;
  }

  it.each([
    ['a nav sidebar', `<nav>${links}</nav>`, `<div class="content">${article}</div>`],
    ['an aside sidebar', `<aside>${links}</aside>`, `<div class="content">${article}</div>`],
    ['a role=navigation sidebar', `<div role="navigation">${links}</div>`, `<div class="content">${article}</div>`],
    ['a role=complementary sidebar', `<div role="complementary">${links}</div>`, `<div class="content">${article}</div>`],
    ['a column inside a nav', `<div>${links}</div>`, `<div class="content">${article}</div>`, 'nav'],
    ['a shell that contains main', `<div>${links}</div>`, `<main>${article}</main>`],
  ])('skips %s', async (_name, side, content, wrapper?: string) => {
    const html = wrapper ? layout(side, content).replace('<div class="layout">', `<${wrapper}><div class="layout">`).replace('</body>', `</${wrapper}></body>`) : layout(side, content);
    const win = await atTablet(html);
    expect(await findings(win, liveStateRules, 'first-viewport-column-overflow')).toEqual([]);
  });

  it('still flags the same layout built from plain divs', async () => {
    const win = await atTablet(layout(`<div>${links}</div>`, `<div class="content">${article}</div>`));
    const hits = await findings(win, liveStateRules, 'first-viewport-column-overflow');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.el).toBe(win.document.querySelector('.layout'));
  });
});

describe('broken-image on an image that fails to load in a real browser', () => {
  it('flags an undecodable src and not a decodable one', async () => {
    const good = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const win = await load(page('', `<img id="bad" alt="" src="data:image/png;base64,AAAA"><img id="good" alt="" src="${good}">`));
    const hits = await findings(win, imageryRules, 'broken-image');
    expect(hits.map((hit) => (hit.el as Element).id)).toEqual(['bad']);
    expect(hits[0]!.detail).toBe('<img src="data:image/png;base64,AAAA"> failed to load');
  });
});
