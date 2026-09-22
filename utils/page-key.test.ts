import { describe, expect, it } from 'vitest';
import { pageKey } from './page-key';

describe('pageKey', () => {
  it('normalizes a page URL without its fragment', () => {
    expect(pageKey('https://example.com/docs?mode=full#section-2')).toBe(
      'page:https://example.com/docs?mode=full',
    );
  });
});
