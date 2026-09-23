import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  allowlistEntryError,
  defaultPolicy,
  isEnabledForUrl,
  parseAllowlistEntry,
  type SitePolicy,
} from './policy';
import {
  readPolicy,
  SITE_POLICY_STORAGE_KEY,
  writePolicy,
} from './storage';

describe('site policy', () => {
  it('enables every URL by default when no policy is stored', async () => {
    await expect(readPolicy()).resolves.toEqual(defaultPolicy);
    expect(isEnabledForUrl('https://any.example/path', defaultPolicy)).toBe(true);
  });

  it('disables every URL when the global toggle is off', () => {
    const policy: SitePolicy = { enabled: false, allowlist: [] };

    expect(isEnabledForUrl('https://example.com', policy)).toBe(false);
    expect(isEnabledForUrl('https://other.example', policy)).toBe(false);
  });

  it('matches allowlist entries by exact hostname', () => {
    const policy: SitePolicy = { enabled: true, allowlist: ['docs.example.com'] };

    expect(isEnabledForUrl('https://docs.example.com/guide', policy)).toBe(true);
    expect(isEnabledForUrl('https://other.example.com/guide', policy)).toBe(false);
  });

  it('accepts an origin entry while still matching its hostname', () => {
    const policy: SitePolicy = { enabled: true, allowlist: ['https://docs.example.com'] };

    expect(isEnabledForUrl('https://docs.example.com/guide', policy)).toBe(true);
  });

  it('rejects an invalid allowlist entry', () => {
    const policy: SitePolicy = { enabled: true, allowlist: ['not a URL'] };

    expect(isEnabledForUrl('https://docs.example.com/guide', policy)).toBe(false);
  });

  it('writes and reads only the site policy key', async () => {
    const policy: SitePolicy = { enabled: false, allowlist: ['example.com'] };

    await writePolicy(policy);

    await expect(readPolicy()).resolves.toEqual(policy);
    await expect(fakeBrowser.storage.local.get(SITE_POLICY_STORAGE_KEY)).resolves.toEqual({
      [SITE_POLICY_STORAGE_KEY]: policy,
    });
  });
});

describe('allowlist entry validation', () => {
  it('normalizes a hostname, URL or origin with port to its lowercase hostname', () => {
    expect(parseAllowlistEntry('docs.example.com')).toBe('docs.example.com');
    expect(parseAllowlistEntry('Docs.Example.COM')).toBe('docs.example.com');
    expect(parseAllowlistEntry('https://docs.example.com/guide?x=1')).toBe('docs.example.com');
    expect(parseAllowlistEntry('http://localhost:5173')).toBe('localhost');
    expect(parseAllowlistEntry('docs.example.com:8080')).toBe('docs.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(parseAllowlistEntry('  docs.example.com\t')).toBe('docs.example.com');
  });

  it('converts an internationalized hostname to punycode', () => {
    expect(parseAllowlistEntry('bücher.example')).toBe('xn--bcher-kva.example');
  });

  it('rejects blank and unparseable entries', () => {
    expect(parseAllowlistEntry('')).toBeUndefined();
    expect(parseAllowlistEntry('   ')).toBeUndefined();
    expect(parseAllowlistEntry('not a host!!')).toBeUndefined();
    expect(parseAllowlistEntry('https://')).toBeUndefined();
  });

  it('names the invalid entry in the error and returns none for a valid one', () => {
    expect(allowlistEntryError('not a host!!')).toBe(
      '"not a host!!" is not a valid site. Use a hostname like docs.example.com or a URL.',
    );
    expect(allowlistEntryError('docs.example.com')).toBeUndefined();
  });

  it('accepts only hosts in the hostname grammar after normalization', () => {
    for (const [entry, host] of [
      ['127.0.0.1', '127.0.0.1'],
      ['http://[::1]:8080/x', '[::1]'],
      ['LOCALHOST', 'localhost'],
      ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
      ['a-b.c1.example', 'a-b.c1.example'],
    ]) {
      expect(parseAllowlistEntry(entry!)).toBe(host);
    }
    for (const entry of [
      '*.example.com',
      'exa mple.com',
      'not a host!!',
      'under_score.example',
      '-lead.example',
      'trail-.example',
      'a..b.example',
      'example.com.',
      'xn--',
      `${'a'.repeat(64)}.example`,
      'example.123',
    ]) {
      expect(parseAllowlistEntry(entry), entry).toBeUndefined();
      expect(allowlistEntryError(entry)).toBe(`"${entry}" is not a valid site. Use a hostname like docs.example.com or a URL.`);
    }
  });
});

beforeEach(() => {
  fakeBrowser.reset();
});
