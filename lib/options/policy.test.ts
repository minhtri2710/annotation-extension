import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  defaultPolicy,
  isEnabledForUrl,
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

beforeEach(() => {
  fakeBrowser.reset();
});
