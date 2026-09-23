// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../engine';
import { motionRules } from './motion';

function resetDocument(): void {
  document.querySelectorAll('style').forEach((style) => style.remove());
  document.documentElement.innerHTML = '<head></head><body></body>';
}

async function scan(markup: string, style = '') {
  document.body.innerHTML = markup;
  if (style) {
    const sheet = document.createElement('style');
    sheet.textContent = style;
    document.head.appendChild(sheet);
  }
  return await collectFindings(motionRules, createScanContext(window), new AbortController().signal);
}

async function ruleFindings(markup: string, ruleId: string, style = '') {
  return (await scan(markup, style)).filter((finding) => finding.ruleId === ruleId);
}

function first<T>(values: T[]): T {
  return values[0]!;
}

beforeEach(resetDocument);

describe('motion lint rules through the real engine', () => {
  it('exports the six motion rules with faithful metadata and scopes', () => {
    expect(motionRules.map((rule) => rule.id)).toEqual([
      'bounce-easing',
      'pulsing-dot',
      'blinking-cursor',
      'marquee',
      'layout-transition',
      'image-hover-transform',
    ]);
    expect(motionRules.find((rule) => rule.id === 'bounce-easing')).toMatchObject({
      category: 'slop',
      name: 'Bounce or elastic easing',
      description: 'Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.',
      skillSection: 'Motion',
      scope: 'element',
    });
    expect(motionRules.find((rule) => rule.id === 'pulsing-dot')).toMatchObject({
      category: 'slop',
      name: 'Pulsing status dot',
      skillSection: 'Motion',
      scope: 'element',
    });
    expect(motionRules.find((rule) => rule.id === 'blinking-cursor')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Decorative blinking cursor',
      description: 'A blinking text cursor animated into a hero or landing section simulates typing where no input exists. It borrows the dev-tool aesthetic as decoration. Real editable fields draw their own caret; anywhere else, let the composition hold attention without a fake prompt.',
      skillSection: 'Motion',
      scope: 'element',
    });
    expect(motionRules.find((rule) => rule.id === 'marquee')).toMatchObject({
      category: 'slop',
      name: 'Auto-scrolling marquee',
      description: 'Continuously auto-scrolling content demands attention it has not earned and hides half its content at any moment. Reserve motion for content that changes; let readers move at their own pace.',
      skillSection: 'Motion',
      scope: 'page',
    });
    expect(motionRules.find((rule) => rule.id === 'layout-transition')).toMatchObject({
      category: 'quality',
      name: 'Layout property animation',
      description: 'Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.',
      skillSection: 'Motion',
      scope: 'element',
    });
    expect(motionRules.find((rule) => rule.id === 'image-hover-transform')).toMatchObject({
      category: 'slop',
      severity: 'advisory',
      name: 'Image hover transform',
      description: 'Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.',
      skillSection: 'Motion',
      scope: 'element',
    });
  });

  it('detects bounce easing and accepts the overshoot boundary', async () => {
    const positive = await ruleFindings(
      '<div id="positive" style="animation-name: spring; animation-timing-function: ease"></div>',
      'bounce-easing',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'bounce-easing',
      detail: 'animation: spring',
    });

    const negative = await ruleFindings(
      '<div id="negative" style="transition-timing-function: cubic-bezier(0.2, -0.1, 0.8, 1.1)"></div>',
      'bounce-easing',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects an infinite pulsing dot and rejects finite iteration counts', async () => {
    const style = '@keyframes pulse { 50% { opacity: 0.5; transform: scale(1.2); } }';
    const positive = await ruleFindings(
      '<div id="positive" style="width: 8px; height: 8px; border-radius: 50%; animation-name: pulse; animation-iteration-count: infinite"></div>',
      'pulsing-dot',
      style,
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'pulsing-dot',
      detail: 'div — 8x8px dot with infinite "pulse" animation',
    });

    const negative = await ruleFindings(
      '<div id="negative" style="width: 8px; height: 8px; border-radius: 50%; animation-name: pulse; animation-iteration-count: 2"></div>',
      'pulsing-dot',
      style,
    );
    expect(negative).toHaveLength(0);

    const tailwind = await ruleFindings(
      '<div id="tailwind" class="animate-pulse rounded-full w-2 h-2"></div>',
      'pulsing-dot',
    );
    expect(tailwind).toHaveLength(1);
    expect(first(tailwind)).toMatchObject({
      ruleId: 'pulsing-dot',
      detail: 'animate-pulse on tiny rounded-full element',
    });
  });

  it('detects an opacity-blinking cursor and rejects a near-threshold block', async () => {
    const style = '@keyframes caret-fade { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }';
    document.body.innerHTML = '<header><span id="positive" style="width: 2px; height: 24px; background-color: rgb(0, 0, 0); animation-name: caret-fade; animation-iteration-count: infinite"></span></header>';
    const positiveElement = document.querySelector('#positive') as HTMLElement;
    positiveElement.getBoundingClientRect = () => ({
      width: 2,
      height: 24,
      top: 200,
      right: 102,
      bottom: 224,
      left: 100,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    const positive = (await collectFindings(motionRules, createScanContext(window), new AbortController().signal)).filter(
      (finding) => finding.ruleId === 'blinking-cursor',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'blinking-cursor',
      severity: 'advisory',
      detail: 'span — 2x24px blinking cursor (animation "caret-fade") in the first viewport',
    });

    document.body.innerHTML = '<span id="negative" style="width: 2px; height: 24px; background-color: rgb(0, 0, 0); animation-name: caret-fade; animation-iteration-count: infinite; border-radius: 1px"></span>';
    const negativeElement = document.querySelector('#negative') as HTMLElement;
    negativeElement.getBoundingClientRect = () => ({
      width: 2,
      height: 24,
      top: 200,
      right: 102,
      bottom: 224,
      left: 100,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    const negative = (await collectFindings(motionRules, createScanContext(window), new AbortController().signal)).filter(
      (finding) => finding.ruleId === 'blinking-cursor',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a marquee element and rejects a finite horizontal animation', async () => {
    const style = '@keyframes slide-loop { from { transform: translateX(0%); } to { transform: translateX(-50%); } }';
    const positive = await ruleFindings('<marquee id="positive">Moving content</marquee>', 'marquee', style);
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'marquee',
      detail: '<marquee> element',
      el: document.querySelector('#positive'),
    });

    const horizontal = await ruleFindings(
      '<div id="horizontal" style="animation-name: slide-loop; animation-iteration-count: infinite"></div>',
      'marquee',
      style,
    );
    expect(horizontal).toHaveLength(1);
    expect(first(horizontal)).toMatchObject({
      ruleId: 'marquee',
      detail: 'div — infinite horizontal loop animation "slide-loop"',
      el: document.querySelector('#horizontal'),
    });

    const negative = await ruleFindings(
      '<div id="negative" style="animation-name: slide-loop; animation-iteration-count: 2"></div>',
      'marquee',
      style,
    );
    expect(negative).toHaveLength(0);
  });

  it('detects a layout transition and accepts a non-layout property', async () => {
    const positive = await ruleFindings(
      '<div id="positive" style="transition-property: width, opacity"></div>',
      'layout-transition',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'layout-transition',
      detail: 'transition: width',
    });

    const negative = await ruleFindings(
      '<div id="negative" style="transition-property: color"></div>',
      'layout-transition',
    );
    expect(negative).toHaveLength(0);
  });

  it('detects an image hover transform and rejects a non-transform hover transition', async () => {
    const style = 'img:hover { transform: scale(1.08); }';
    const positive = await ruleFindings('<img id="positive" src="photo.png">', 'image-hover-transform', style);
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({
      ruleId: 'image-hover-transform',
      severity: 'advisory',
      detail: 'img:hover { transform } rule',
    });

    resetDocument();
    const negative = await ruleFindings('<img id="negative" src="photo.png">', 'image-hover-transform', 'img:hover { opacity: 0.8; }');
    expect(negative).toHaveLength(0);
  });

  it('fires on an unguarded stylesheet pulsing dot, even when another element is guarded', async () => {
    const dot = '<span class="dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%"></span>';
    const positive = await ruleFindings(
      dot,
      'pulsing-dot',
      '@keyframes pulse { 50% { opacity: 0.4; } } .dot { animation-name: pulse; animation-iteration-count: infinite; } @media (prefers-reduced-motion: reduce) { .other { animation: none; } }',
    );
    expect(positive).toHaveLength(1);
    expect(first(positive)).toMatchObject({ detail: 'span.dot — 8x8px dot with infinite "pulse" animation' });
  });

  it.each([
    ['animation-name: none', '.dot { animation-name: none; }'],
    ['a finite iteration count reset', '*, *::before { animation-iteration-count: 1 !important; }'],
  ])('skips a pulsing dot switched off by a prefers-reduced-motion reduce rule (%s)', async (_label, reduce) => {
    const findings = await ruleFindings(
      '<span class="dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%"></span>',
      'pulsing-dot',
      `@keyframes pulse { 50% { opacity: 0.4; } } .dot { animation-name: pulse; animation-iteration-count: infinite; } @media (prefers-reduced-motion: reduce) { ${reduce} }`,
    );
    expect(findings).toHaveLength(0);
  });

  it('skips a pulsing dot whose animation is only set under prefers-reduced-motion no-preference', async () => {
    const findings = await ruleFindings(
      '<span class="dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%"></span>',
      'pulsing-dot',
      '@keyframes pulse { 50% { opacity: 0.4; } } @media (prefers-reduced-motion:no-preference) { .dot { animation-name: pulse; animation-iteration-count: infinite; } }',
    );
    expect(findings).toHaveLength(0);
  });

  it('fires when a guarded rule is joined by an unguarded inline animation', async () => {
    const findings = await ruleFindings(
      '<span class="dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; animation-name: pulse; animation-iteration-count: infinite"></span>',
      'pulsing-dot',
      '@keyframes pulse { 50% { opacity: 0.4; } } @media (prefers-reduced-motion: no-preference) { .dot { animation-name: pulse; animation-iteration-count: infinite; } }',
    );
    expect(findings).toHaveLength(1);
  });
});
