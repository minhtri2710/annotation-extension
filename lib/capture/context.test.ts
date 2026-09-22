// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { extractElementContext } from './context';

describe('extractElementContext', () => {
  it('captures identifying fields, truncated text, and page geometry shape', () => {
    document.body.innerHTML = '<button id="capture" class="primary rounded">' + 'x'.repeat(250) + '</button>';
    const element = document.querySelector('#capture') as HTMLElement;

    const context = extractElementContext(element);

    expect(context).toMatchObject({
      selector: '#capture',
      tagName: 'BUTTON',
      id: 'capture',
      classList: ['primary', 'rounded'],
      text: 'x'.repeat(200),
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
    expect(context.text).toHaveLength(200);
    expect(context).toHaveProperty('boundingBox');
    expect(context.boundingBox).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });
});
