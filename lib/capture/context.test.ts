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
    expect(context.boundingBox).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it('collapses whitespace runs to one space and trims the text', () => {
    document.body.innerHTML = '<div id="host">\n  <p>alpha \t beta</p>\n\n  <span>gamma</span>   delta \n</div>';

    const context = extractElementContext(document.querySelector('#host') as HTMLElement);

    expect(context.text).toBe('alpha beta gamma delta');
  });

  it('applies the 200-character cap to the cleaned text', () => {
    document.body.innerHTML = '<div id="host"><style>' + 'a{b:c}'.repeat(100) + '</style>' + 'v'.repeat(250) + '</div>';

    const context = extractElementContext(document.querySelector('#host') as HTMLElement);

    expect(context.text).toBe('v'.repeat(200));
  });

  it('counts the cap after whitespace is collapsed, so long indentation does not cut visible text', () => {
    document.body.innerHTML = '<div id="host">start' + ' '.repeat(300) + 'end</div>';

    const context = extractElementContext(document.querySelector('#host') as HTMLElement);

    expect(context.text).toBe('start end');
  });
});
