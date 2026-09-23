// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { liveStateRules } from './live-state';

type RectValues = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function resetDocument(): void {
  document.querySelectorAll('style').forEach((style) => style.remove());
  document.documentElement.innerHTML = '<head></head><body></body>';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
}

function rect({ left, top, width, height }: RectValues): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRect(el: Element, values: RectValues): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(values),
  });
}

function stubMetric(el: Element, name: 'clientWidth' | 'clientHeight' | 'clientLeft' | 'scrollWidth' | 'scrollHeight' | 'scrollLeft', value: number): void {
  Object.defineProperty(el, name, { configurable: true, value });
}

function scan(markup: string) {
  document.body.innerHTML = markup;
  return collectFindings(liveStateRules, createScanContext(window));
}

function ruleFindings(markup: string, ruleId: string) {
  return scan(markup).filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

beforeEach(resetDocument);
afterEach(() => vi.restoreAllMocks());

describe('live-state lint rules through the real engine', () => {
  it('exports the six rules in registry order with faithful metadata', () => {
    expect(liveStateRules.map((rule) => rule.id)).toEqual([
      'edge-flush-cards',
      'text-occlusion',
      'first-viewport-column-overflow',
      'text-overflow',
      'repeated-container-text',
      'clipped-overflow-container',
    ]);
    expect(liveStateRules.find((rule) => rule.id === 'edge-flush-cards')).toMatchObject({
      category: 'quality',
      name: 'Cards flush against the scroller edge',
      description: 'Cards inside a horizontal scroller or tab panel sit flush against the container edge at rest while keeping a gutter on the other side, so their edges and rounded corners get cut off. Usually the panel is sized wider than its clip box. Keep a consistent inset on both sides.',
      scope: 'page',
    });
    expect(liveStateRules.find((rule) => rule.id === 'text-occlusion')).toMatchObject({
      category: 'quality',
      name: 'Text occluded by an overlapping element',
      description: 'Text is painted under an opaque element or a second text run, so part of it cannot be read. A decorative box, a stacked layer, or an inline element with leaked padding lands on the words instead of beside them. Give overlapping layers room, or move the text out from under the layer above it.',
      skillSection: 'Layout & Space',
      scope: 'page',
    });
    expect(liveStateRules.find((rule) => rule.id === 'first-viewport-column-overflow')).toMatchObject({
      category: 'quality',
      name: 'One column stretches the first viewport',
      skillSection: 'Layout & Space',
      scope: 'page',
    });
    expect(liveStateRules.find((rule) => rule.id === 'text-overflow')).toMatchObject({
      category: 'quality',
      name: 'Content overflowing its container',
      skillSection: 'Layout & Space',
      scope: 'element',
    });
    expect(liveStateRules.find((rule) => rule.id === 'repeated-container-text')).toMatchObject({
      category: 'quality',
      name: 'Same text repeated inside one container',
      scope: 'page',
    });
    expect(liveStateRules.find((rule) => rule.id === 'clipped-overflow-container')).toMatchObject({
      category: 'quality',
      name: 'Positioned child clipped by overflow container',
      skillSection: 'Layout & Space',
      scope: 'element',
    });
    expect(liveStateRules.every((rule) => rule.severity === undefined)).toBe(true);
  });

  it('detects edge-flush cards and accepts the 8px right-gap boundary', () => {
    document.body.innerHTML = '<div class="scroller" style="overflow-x: auto"><article class="card" style="background: rgb(255, 255, 255)"></article></div>';
    const scroller = document.querySelector('.scroller')!;
    const card = document.querySelector('.card')!;
    stubRect(scroller, { left: 0, top: 0, width: 600, height: 180 });
    stubRect(card, { left: 24, top: 20, width: 574, height: 120 });
    stubMetric(scroller, 'scrollWidth', 900);
    stubMetric(scroller, 'clientWidth', 600);
    stubMetric(scroller, 'scrollLeft', 0);
    stubMetric(scroller, 'clientLeft', 0);
    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'edge-flush-cards',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'edge-flush-cards',
      detail: '1 card flush against the right edge of div.scroller at rest (2px gap, e.g. article.card)',
    });

    stubRect(card, { left: 24, top: 20, width: 568, height: 120 });
    const negative = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'edge-flush-cards',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects live hit-test occlusion and accepts a 29% opaque-box coverage', () => {
    document.body.innerHTML = '<div class="headline">Readable headline</div><div class="cover" style="background: rgb(255, 255, 255)"></div>';
    const headline = document.querySelector('.headline')!;
    const cover = document.querySelector('.cover')!;
    stubRect(headline, { left: 100, top: 100, width: 240, height: 28 });
    stubRect(cover, { left: 100, top: 100, width: 240, height: 28 });
    const point = vi.spyOn(document, 'elementFromPoint').mockImplementation(() => cover);
    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'text-occlusion',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'text-occlusion',
      detail: 'div.headline "Readable headline" is 100% covered by an opaque element (div.cover)',
    });

    point.mockImplementation((x) => x < 150 ? cover : headline);
    const negative = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'text-occlusion',
    );
    expect(negative).toHaveLength(0);
    point.mockRestore();
  });

  it('detects a first-viewport column running past the fold and accepts 140% height', () => {
    document.body.innerHTML = '<section class="opening" style="display: grid; position: relative"><div class="tall" style="display: block"></div><div class="short" style="display: block"></div></section>';
    const currentSection = document.querySelector('.opening')!;
    const currentTall = document.querySelector('.tall')!;
    const currentShort = document.querySelector('.short')!;
    stubRect(currentSection, { left: 0, top: 0, width: 1000, height: 1500 });
    stubRect(currentTall, { left: 0, top: 0, width: 480, height: 1200 });
    stubRect(currentShort, { left: 520, top: 0, width: 480, height: 300 });
    const tallContent = document.createElement('div');
    const shortContent = document.createElement('div');
    currentTall.appendChild(tallContent);
    currentShort.appendChild(shortContent);
    stubRect(tallContent, { left: 0, top: 0, width: 480, height: 1200 });
    stubRect(shortContent, { left: 520, top: 0, width: 480, height: 300 });
    const findings = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'first-viewport-column-overflow',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings)).toMatchObject({
      ruleId: 'first-viewport-column-overflow',
      detail: 'section.opening opens the page with one column running 150% of the viewport tall while a sibling fits in 38% — the fold falls deep inside the section',
    });

    stubRect(tallContent, { left: 0, top: 0, width: 480, height: 1120 });
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'first-viewport-column-overflow',
    )).toHaveLength(0);
  });

  it('detects text overflow and accepts the 15px delta boundary', () => {
    document.body.innerHTML = '<div class="overflowing">A long direct text run</div>';
    const overflowing = document.querySelector('.overflowing')!;
    stubRect(overflowing, { left: 0, top: 0, width: 100, height: 24 });
    stubMetric(overflowing, 'clientWidth', 100);
    stubMetric(overflowing, 'scrollWidth', 115);
    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'text-overflow',
    );
    expect(positive).toHaveLength(0);

    stubMetric(overflowing, 'scrollWidth', 116);
    const findings = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'text-overflow',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings)).toMatchObject({
      ruleId: 'text-overflow',
      detail: 'div.overflowing overflows its box by 16px',
    });
  });

  it('detects repeated container text and rejects two occurrences', () => {
    document.body.innerHTML = '<div class="card" style="background-color: rgb(255, 255, 255); border-top: 1px solid rgb(0, 0, 0); border-right: 1px solid rgb(0, 0, 0); border-bottom: 1px solid rgb(0, 0, 0); border-radius: 8px"><div class="slot-one">Active</div><div class="slot-two">Active</div><div class="slot-three">Active</div></div>';
    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'repeated-container-text',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'repeated-container-text',
      detail: '"Active" rendered 3× in distinct spots inside div.card',
    });

    document.body.innerHTML = '<div class="card" style="background-color: rgb(255, 255, 255); border-top: 1px solid rgb(0, 0, 0); border-right: 1px solid rgb(0, 0, 0); border-bottom: 1px solid rgb(0, 0, 0); border-radius: 8px"><div class="slot-one">Active</div><div class="slot-two">Active</div></div>';
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'repeated-container-text',
    )).toHaveLength(0);
  });

  it('detects a positioned child escaping a clip and accepts the 2px threshold', () => {
    document.body.innerHTML = '<div class="card" style="overflow-x: hidden; overflow-y: hidden; position: relative"><div class="menu" style="position: absolute">Menu item</div></div>';
    const card = document.querySelector('.card')!;
    const menu = document.querySelector('.menu')!;
    stubRect(card, { left: 100, top: 100, width: 200, height: 100 });
    stubRect(menu, { left: 97, top: 110, width: 120, height: 40 });

    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'clipped-overflow-container',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'clipped-overflow-container',
      detail: 'div.card clips a positioned child',
    });

    stubRect(menu, { left: 98, top: 110, width: 120, height: 40 });
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'clipped-overflow-container',
    )).toHaveLength(0);
  });

  it('ignores a zero-width-bordered card without background at the flush edge', () => {
    document.body.innerHTML = '<div class="scroller" style="overflow-x: auto"><article class="card" style="background-color: transparent; border-top: 0px solid rgb(0, 0, 0); border-right: 0px solid rgb(0, 0, 0); border-bottom: 0px solid rgb(0, 0, 0); border-left: 0px solid rgb(0, 0, 0)"></article></div>';
    const scroller = document.querySelector('.scroller')!;
    const card = document.querySelector('.card')!;
    stubRect(scroller, { left: 0, top: 0, width: 600, height: 180 });
    stubRect(card, { left: 24, top: 20, width: 574, height: 120 });
    stubMetric(scroller, 'scrollWidth', 900);
    stubMetric(scroller, 'clientWidth', 600);
    stubMetric(scroller, 'scrollLeft', 0);
    stubMetric(scroller, 'clientLeft', 0);
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'edge-flush-cards',
    )).toHaveLength(0);
  });

  it('keeps a partially clipped element eligible for text-overflow findings', () => {
    document.body.innerHTML = '<div class="peek" style="clip-path: inset(50% 0 0 0)">A long direct text run</div>';
    const peek = document.querySelector('.peek')!;
    stubRect(peek, { left: 0, top: 0, width: 100, height: 24 });
    stubMetric(peek, 'clientWidth', 100);
    stubMetric(peek, 'scrollWidth', 116);
    const findings = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'text-overflow',
    );
    expect(findings).toHaveLength(1);
    expect(first(findings)).toMatchObject({
      ruleId: 'text-overflow',
      detail: 'div.peek overflows its box by 16px',
    });
  });

  it('skips icon-classified slots when collecting repeated container text', () => {
    document.body.innerHTML = '<div class="card" style="background-color: rgb(255, 255, 255); border-top: 1px solid rgb(0, 0, 0); border-right: 1px solid rgb(0, 0, 0); border-bottom: 1px solid rgb(0, 0, 0); border-radius: 8px"><div class="iconic-slot-one">Active</div><div class="iconic-slot-two">Active</div><div class="iconic-slot-three">Active</div></div>';
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'repeated-container-text',
    )).toHaveLength(0);
  });

  it('falls back to the inset style when positioned-child geometry is unavailable', () => {
    document.body.innerHTML = '<div class="card" style="overflow: hidden; position: relative"><div class="menu" style="position: absolute; left: -10px">Menu item</div></div>';
    const card = document.querySelector('.card')!;
    const menu = document.querySelector('.menu')!;
    stubRect(card, { left: 100, top: 100, width: 200, height: 100 });
    const positive = collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'clipped-overflow-container',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'clipped-overflow-container',
      detail: 'div.card clips a positioned child',
    });

    menu.setAttribute('style', 'position: absolute; left: 10px');
    expect(collectFindings(liveStateRules, createScanContext(window)).filter(
      (finding) => finding.ruleId === 'clipped-overflow-container',
    )).toHaveLength(0);
  });
});
