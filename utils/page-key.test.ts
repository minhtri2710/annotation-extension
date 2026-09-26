import { describe, expect, it } from 'vitest';
import { pageKey } from './page-key';

describe('pageKey', () => {
  it('normalizes a page URL without its fragment', () => {
    expect(pageKey('https://example.com/docs?mode=full#section-2')).toBe(
      'page:https://example.com/docs?mode=full',
    );
  });

  it('treats an empty query as no query and keeps non-empty queries distinct', () => {
    expect(pageKey('https://a.com/x?')).toBe(pageKey('https://a.com/x'));
    expect(pageKey('https://a.com/x?q=1')).not.toBe(pageKey('https://a.com/x'));
    expect(pageKey('https://a.com/x?q?')).toBe('page:https://a.com/x?q?');
  });
});
