// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { layoutSpaceRules } from './layout-space';

function resetDocument(): void {
  document.querySelectorAll('style').forEach((style) => style.remove());
  document.documentElement.innerHTML = '<head></head><body></body>';
}

function scan(markup: string, style = '', config = {}) {
  document.body.innerHTML = markup;
  if (style) {
    const sheet = document.createElement('style');
    sheet.textContent = style;
    document.head.appendChild(sheet);
  }
  return collectFindings(layoutSpaceRules, createScanContext(window, config));
}

function ruleFindings(markup: string, ruleId: string, style = '', config = {}) {
  return scan(markup, style, config).filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function domRectList(rects: DOMRect[]): DOMRectList {
  return Object.assign(rects, {
    item: (index: number): DOMRect | null => rects[index] ?? null,
  });
}

function stubRectsById(rects: Record<string, DOMRect>): void {
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
    const node = this.startContainer;
    const element = node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node instanceof Element ? node : null;
    return element ? domRectList([rects[element.id] ?? rect(0, 0, 0, 0)]) : domRectList([]);
  });
}

type StyleOverrides = Record<string, string>;

function stubComputedStyle(overridesByElement: Array<[Element, StyleOverrides]>): void {
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const base = realGetComputedStyle(el, pseudo);
    const entry = overridesByElement.find(([target]) => target === el);
    if (!entry) return base;
    const overrides = entry[1];
    return new Proxy(base, {
      get(underlying, property) {
        if (property === 'getPropertyValue') {
          return (name: string): string => {
            const key = String(name).toLowerCase();
            return key in overrides ? overrides[key]! : underlying.getPropertyValue(String(name));
          };
        }
        if (typeof property === 'string' && property in overrides) return overrides[property];
        const value = Reflect.get(underlying, property);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(underlying)
          : value;
      },
    });
  });
}

beforeEach(resetDocument);
afterEach(() => {
  vi.restoreAllMocks();
  resetDocument();
});

describe('layout and space lint rules through the real engine', () => {
  it('exports the seven rules in registry order with faithful metadata', () => {
    expect(layoutSpaceRules.map((rule) => rule.id)).toEqual([
      'nested-cards',
      'monotonous-spacing',
      'numbered-section-labels',
      'line-length',
      'cramped-padding',
      'body-text-viewport-edge',
      'heading-rhythm',
    ]);
    expect(layoutSpaceRules).toMatchObject([
      {
        id: 'nested-cards',
        category: 'slop',
        name: 'Nested cards',
        description: 'Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.',
        skillSection: 'Layout & Space',
        scope: 'page',
      },
      {
        id: 'monotonous-spacing',
        category: 'slop',
        name: 'Monotonous spacing',
        description: 'The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.',
        skillSection: 'Layout & Space',
        scope: 'page',
      },
      {
        id: 'numbered-section-labels',
        category: 'slop',
        severity: 'advisory',
        name: 'Tiny numbered section labels',
        description: 'Small numeric index labels riding next to section headings, repeated section after section, are AI editorial scaffolding — a page numbering its own chapters instead of earning structure. Let hierarchy, content, and rhythm carry the sequence.',
        skillSection: 'Layout & Space',
        scope: 'page',
      },
      {
        id: 'line-length',
        category: 'quality',
        name: 'Line length too long',
        description: 'Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line, so it is measured on the lines that rendered and charged when more than one of them runs long. Add a max-width (65ch to 75ch) to text containers.',
        skillSection: 'Layout & Space',
        scope: 'element',
      },
      {
        id: 'cramped-padding',
        category: 'quality',
        name: 'Cramped padding',
        description: 'Text is too close to the edge of its container. Two shapes: (1) an element with its own text where the space between the rendered text and the border box is too small for the font size, and (2) a wrapper whose children\'s text lands flush against a visible boundary (border, outline, or non-transparent background) with nothing to inset it. Add at least 8px (ideally 12–16px) of space inside bordered, outlined, or colored containers.',
        skillSection: 'Layout & Space',
        scope: 'element',
      },
      {
        id: 'body-text-viewport-edge',
        category: 'quality',
        name: 'Body text touching viewport edge',
        description: 'Body paragraphs render flush against the left or right viewport edge with no container providing horizontal padding. Wrap content in a container with at least 16px (ideally 24-32px) of horizontal padding, or apply max-width with mx-auto.',
        scope: 'element',
      },
      {
        id: 'heading-rhythm',
        category: 'quality',
        name: 'Heading crowded against the previous block',
        description: 'A heading binds to the content it introduces, so the rendered space above it should exceed the space below it. When headings across a page sit as close or closer to the block above than to their own content, every section reads as if it captions the previous one. Open up the space above each heading.',
        skillSection: 'Layout & Space',
        scope: 'page',
      },
    ]);
    expect(layoutSpaceRules.find((rule) => rule.id === 'body-text-viewport-edge')).not.toHaveProperty('skillSection');
  });

  it('detects nested cards and accepts a card-sized non-card boundary', () => {
    document.body.innerHTML = '<div id="outer" class="border rounded" style="background-color: white"><div id="inner" class="border rounded" style="background-color: white">Inner card content</div></div>';
    const outer = document.querySelector('#outer')!;
    const inner = document.querySelector('#inner')!;
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 240));
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(rect(24, 24, 300, 160));
    const positive = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'nested-cards',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({ ruleId: 'nested-cards', detail: 'Card inside card', el: inner });

    const negative = ruleFindings(
      '<div id="negative" class="border rounded" style="background-color: white">A single card only</div>',
      'nested-cards',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects monotonous spacing only above the strict 60 percent boundary', () => {
    const positiveStyle = '.a{padding:16px;margin:16px;gap:16px;padding-top:16px;margin-left:16px;padding-right:16px;margin-bottom:16px;padding-left:8px;margin-top:12px;margin-right:8px;}';
    const positive = ruleFindings('<div class="a"></div>', 'monotonous-spacing', positiveStyle);
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'monotonous-spacing',
      detail: '~16px used 7/10 times (70%)',
    });

    const negativeStyle = '.a{padding:16px;margin:16px;gap:16px;padding-top:16px;margin-left:16px;padding-right:16px;padding-left:8px;margin-top:12px;margin-right:20px;margin-bottom:24px;}';
    const negative = ruleFindings('<div class="a"></div>', 'monotonous-spacing', negativeStyle);
    expect(negative).toHaveLength(0);
  });

  it('detects repeated numbered labels and rejects a single near-threshold candidate', () => {
    const positive = ruleFindings(
      '<section><span style="font-size:11px;letter-spacing:1px;font-weight:700;font-family:monospace">01</span><h2 style="font-size:28px">First section</h2></section><section><span style="font-size:11px;letter-spacing:1px;font-weight:700;font-family:monospace">02</span><h2 style="font-size:28px">Second section</h2></section>',
      'numbered-section-labels',
    );
    expect(positive).toHaveLength(2);
    expect(first(positive)).toMatchObject({
      ruleId: 'numbered-section-labels',
      severity: 'advisory',
      detail: 'tiny numbered label "01" beside h2 "First section" (2 on page)',
    });
    expect(positive[1]).toMatchObject({ detail: 'tiny numbered label "02" beside h2 "Second section" (2 on page)' });

    const negative = ruleFindings(
      '<section><span style="font-size:13.01px;letter-spacing:1px;font-weight:700;font-family:monospace">01</span><h2 style="font-size:28px">Only section</h2></section>',
      'numbered-section-labels',
    );
    expect(negative).toHaveLength(0);
  });

  it('charges rendered long lines, merges fragments, and stands down at one long line', () => {
    document.body.innerHTML = `<p id="positive">${'w'.repeat(300)}</p><p id="negative">${'q'.repeat(190)}</p>`;
    vi.spyOn(document.querySelector('#positive')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 72));
    vi.spyOn(document.querySelector('#negative')!, 'getBoundingClientRect').mockReturnValue(rect(0, 300, 1000, 48));
    stubRectsById({
      positive: rect(0, 0, 1000, 19),
      negative: rect(0, 0, 1000, 19),
    });
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      const element = this.startContainer.parentElement!;
      if (element.id === 'positive') {
        return domRectList([
          rect(0, 100, 520, 19), rect(520, 100, 480, 19),
          rect(0, 124, 510, 19), rect(510, 124, 490, 19),
          rect(0, 148, 505, 19), rect(505, 148, 495, 19),
        ]);
      }
      return domRectList([rect(0, 300, 1000, 19), rect(0, 324, 120, 19)]);
    });
    const findings = collectFindings(layoutSpaceRules, createScanContext(window));
    const positive = findings.filter((finding) => finding.ruleId === 'line-length');
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'line-length',
      detail: '~100 chars on 3 of 3 rendered lines (aim for <80)',
      el: document.querySelector('#positive'),
    });
    expect(findings.some((finding) => finding.ruleId === 'line-length' && finding.el?.id === 'negative')).toBe(false);

    document.body.innerHTML = `<p id="box">${'x'.repeat(158)}</p>`;
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return domRectList([rect(200, 974, 995.4, 18), rect(200, 998, 85.5, 18)]);
    });
    const renderedNotBox = ruleFindings(`<p id="box">${'x'.repeat(158)}</p>`, 'line-length');
    expect(renderedNotBox).toHaveLength(0);
  });

  it('merges line fragments, keeps same-row columns separate, and stands down without line geometry', () => {
    document.body.innerHTML = `<p id="columns">${'x'.repeat(240)}</p>`;
    vi.spyOn(document.querySelector('#columns')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 72));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return domRectList([
        rect(0, 100, 350, 19), rect(650, 100, 350, 19),
        rect(0, 124, 350, 19), rect(650, 124, 350, 19),
        rect(0, 148, 350, 19), rect(650, 148, 350, 19),
      ]);
    });
    expect(collectFindings(layoutSpaceRules, createScanContext(window)).filter((finding) => finding.ruleId === 'line-length')).toHaveLength(0);

    document.body.innerHTML = `<p id="missing">${'x'.repeat(300)}</p>`;
    vi.spyOn(document.querySelector('#missing')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 72));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return domRectList([]);
    });
    expect(collectFindings(layoutSpaceRules, createScanContext(window)).filter((finding) => finding.ruleId === 'line-length')).toHaveLength(0);

    document.body.innerHTML = `<p id="leading" style="line-height:10px">${'x'.repeat(300)}</p>`;
    vi.spyOn(document.querySelector('#leading')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 19));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return domRectList([rect(0, 100, 1000, 19)]);
    });
    expect(collectFindings(layoutSpaceRules, createScanContext(window)).filter((finding) => finding.ruleId === 'line-length')).toHaveLength(0);
  });

  it('detects child text flush against a bordered wrapper and accepts an inset child', () => {
    document.body.innerHTML = '<section id="positive" class="frame" style="position:static;border:1px solid black;padding:28px 0 0"><p id="positive-child" style="margin:0">Wrapper text content</p></section>';
    const positiveFrame = document.querySelector('#positive')!;
    const positiveChild = document.querySelector('#positive-child')!;
    vi.spyOn(positiveFrame, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    vi.spyOn(positiveChild, 'getBoundingClientRect').mockReturnValue(rect(0, 28, 400, 20));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return this.startContainer.parentElement?.id === 'positive-child'
        ? domRectList([rect(0, 28, 400, 20)])
        : domRectList([]);
    });
    const positive = collectFindings(layoutSpaceRules, createScanContext(window)).filter((finding) => finding.ruleId === 'cramped-padding');
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'cramped-padding',
      detail: '<section> "frame": children flush against border on right/left (no inset)',
      el: positiveFrame,
    });

    document.body.innerHTML = '<section id="negative" class="frame" style="position:static;border:1px solid black;padding:28px 8px 0"><p id="negative-child" style="margin:0">Wrapper text content</p></section>';
    const negativeFrame = document.querySelector('#negative')!;
    const negativeChild = document.querySelector('#negative-child')!;
    vi.spyOn(negativeFrame, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    vi.spyOn(negativeChild, 'getBoundingClientRect').mockReturnValue(rect(8, 28, 384, 20));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return this.startContainer.parentElement?.id === 'negative-child'
        ? domRectList([rect(8, 28, 384, 20)])
        : domRectList([]);
    });
    expect(collectFindings(layoutSpaceRules, createScanContext(window)).filter((finding) => finding.ruleId === 'cramped-padding')).toHaveLength(0);
  });

  it('recovers the outline boundary from the shorthand when outline-width reads zero', () => {
    document.body.innerHTML = '<section id="frame" class="outline-frame" style="position:static"><p id="child" style="margin:0;padding:0">Wrapper text content</p></section>';
    const frame = document.querySelector('#frame')!;
    const child = document.querySelector('#child')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 40));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return this.startContainer.parentElement === child
        ? domRectList([rect(0, 0, 400, 20)])
        : domRectList([]);
    });
    stubComputedStyle([
      [frame, {
        'outline-width': '0px',
        'outline-style': '',
        'outline-color': '',
        outline: '2px solid rgb(0, 0, 0)',
        'border-top-width': '0px',
        'border-right-width': '0px',
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'background-color': 'rgba(0, 0, 0, 0)',
        position: 'static',
        'padding-top': '0px',
        'padding-right': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'font-size': '16px',
      }],
      [child, {
        'padding-top': '0px',
        'padding-right': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'margin-top': '0px',
        'margin-right': '0px',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'font-size': '16px',
      }],
    ]);
    const findings = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'cramped-padding',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings)).toMatchObject({
      ruleId: 'cramped-padding',
      detail: '<section> "outline-frame": children flush against outline on top/right/left (no inset)',
      el: frame,
    });
  });

  it('reports only the first class token in the cramped-padding wrapper detail', () => {
    document.body.innerHTML = '<section id="frame" class="card featured" style="position:static;border:1px solid black;padding:28px 0 0"><p id="child" style="margin:0">Wrapper text content</p></section>';
    const frame = document.querySelector('#frame')!;
    const child = document.querySelector('#child')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(rect(0, 28, 400, 20));
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      return this.startContainer.parentElement === child
        ? domRectList([rect(0, 28, 400, 20)])
        : domRectList([]);
    });
    const findings = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'cramped-padding',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings).detail).toContain('"card"');
    expect(first(findings).detail).not.toContain('"card featured"');
  });

  it('detects cramped rendered text and accepts the exact safe vertical threshold', () => {
    document.body.innerHTML = `<div id="positive" style="width:300px;height:60px;background-color:rgb(240,240,240);border:1px solid black;font-size:16px">${'word '.repeat(10)}</div><div id="negative" style="width:300px;height:60px;background-color:rgb(240,240,240);border:1px solid black;font-size:16px">${'word '.repeat(10)}</div>`;
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function getClientRects(this: Range) {
      const element = this.startContainer.parentElement!;
      return domRectList([element.id === 'positive' ? rect(52, 103, 276, 19) : rect(52, 105.81, 276, 19)]);
    });
    vi.spyOn(document.querySelector('#positive')!, 'getBoundingClientRect').mockReturnValue(rect(40, 100, 300, 60));
    vi.spyOn(document.querySelector('#negative')!, 'getBoundingClientRect').mockReturnValue(rect(40, 100, 300, 60));
    const findings = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'cramped-padding',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings)).toMatchObject({
      ruleId: 'cramped-padding',
      detail: '2px of space above and below the text (need ≥4.8px for 16px text)',
      el: document.querySelector('#positive'),
    });
    expect(findings.some((finding) => finding.el?.id === 'negative')).toBe(false);
  });

  it('detects body text at the viewport edge and accepts a 16px gutter', () => {
    const positive = ruleFindings(
      `<p id="positive" style="background-color:transparent;position:static">${'Body copy '.repeat(7)}</p>`,
      'body-text-viewport-edge',
    );
    const positiveElement = document.querySelector('#positive')!;
    vi.spyOn(positiveElement, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 900, 80));
    const rescannedPositive = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'body-text-viewport-edge',
    );
    expect(rescannedPositive).toHaveLength(1);
    expect(first(rescannedPositive)).toMatchObject({
      ruleId: 'body-text-viewport-edge',
      detail: '<p> with 69-char body bleeds to viewport edge (left 0px)',
    });
    expect(positive).toHaveLength(0);

    document.body.innerHTML = `<p id="negative" style="background-color:transparent;position:static">${'Body copy '.repeat(7)}</p>`;
    vi.spyOn(document.querySelector('#negative')!, 'getBoundingClientRect').mockReturnValue(rect(16, 100, 900, 80));
    const negative = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'body-text-viewport-edge',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects two heading-rhythm violations and rejects a deficit below 12px', () => {
    document.body.innerHTML = `
      <div id="before1">${'Previous block '.repeat(7)}</div><h2 id="h1">First section</h2><div id="after1">First content</div>
      <div id="before2">${'Previous block '.repeat(7)}</div><h2 id="h2">Second section</h2><div id="after2">Second content</div>`;
    const positions: Record<string, DOMRect> = {
      before1: rect(0, 0, 400, 90), h1: rect(0, 100, 400, 30), after1: rect(0, 160, 400, 100),
      before2: rect(0, 290, 400, 10), h2: rect(0, 300, 400, 30), after2: rect(0, 360, 400, 100),
    };
    for (const [id, value] of Object.entries(positions)) {
      vi.spyOn(document.querySelector(`#${id}`)!, 'getBoundingClientRect').mockReturnValue(value);
    }
    const positive = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'heading-rhythm',
    );
    expect(positive).toHaveLength(2);
    expect(first(positive)).toMatchObject({
      ruleId: 'heading-rhythm',
      detail: 'h2 "First section" has 10px above vs 30px below — it reads as bound to the block above (2 headings on page)',
      el: document.querySelector('#h1'),
    });

    document.body.innerHTML = `
      <div id="before1">${'Previous block '.repeat(7)}</div><h2 id="h1">First section</h2><div id="after1">First content</div>
      <div id="before2">${'Previous block '.repeat(7)}</div><h2 id="h2">Second section</h2><div id="after2">Second content</div>`;
    const near: Record<string, DOMRect> = {
      before1: rect(0, 0, 400, 90), h1: rect(0, 110, 400, 30), after1: rect(0, 160, 400, 100),
      before2: rect(0, 290, 400, 10), h2: rect(0, 300, 400, 30), after2: rect(0, 350, 400, 100),
    };
    for (const [id, value] of Object.entries(near)) {
      vi.spyOn(document.querySelector(`#${id}`)!, 'getBoundingClientRect').mockReturnValue(value);
    }
    const negative = collectFindings(layoutSpaceRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'heading-rhythm',
    );
    expect(negative).toHaveLength(0);
  });
});
