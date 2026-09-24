import { afterEach, describe, expect, it } from 'vitest';
import { createLocateHighlight } from './locate-highlight';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

// Waits until scrollY holds for 3 frames in a row, at most 2 s.
async function scrollSettled(): Promise<void> {
  const deadline = performance.now() + 2000;
  let last = scrollY;
  let still = 0;
  while (still < 3 && performance.now() < deadline) {
    await nextFrame();
    still = scrollY === last ? still + 1 : 0;
    last = scrollY;
  }
}

function expectOver(box: Element, el: Element): void {
  const shown = box.getBoundingClientRect();
  const target = el.getBoundingClientRect();
  expect(Math.abs(shown.top - target.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(shown.left - target.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(shown.bottom - target.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(shown.right - target.right)).toBeLessThanOrEqual(1);
}

describe('locate highlight in a real browser', () => {
  it('lands on an element below the fold after a smooth scroll and follows later scrolling', async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = 'smooth';
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    const target = document.createElement('p');
    target.textContent = 'Far below';
    Object.assign(target.style, { margin: '0', width: '200px', height: '40px' });
    const after = document.createElement('div');
    after.style.height = '2000px';
    const root = document.createElement('div');
    document.body.append(spacer, target, after, root);
    const highlight = createLocateHighlight();
    cleanups.push(() => {
      highlight.remove();
      spacer.remove();
      target.remove();
      after.remove();
      root.remove();
      html.style.scrollBehavior = '';
      scrollTo({ top: 0, behavior: 'instant' });
    });

    highlight.show(root, target);
    await scrollSettled();
    const box = root.querySelector('[data-annotation-scan-highlight]')!;
    expect(scrollY).toBeGreaterThan(3000);
    expectOver(box, target);

    scrollBy({ top: 100, behavior: 'instant' });
    await nextFrame();
    await nextFrame();
    expectOver(box, target);
  });
});
