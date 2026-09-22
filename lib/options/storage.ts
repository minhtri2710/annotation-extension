import { browser } from 'wxt/browser';
import { defaultPolicy, type SitePolicy } from './policy';

export const SITE_POLICY_STORAGE_KEY = 'options:site-policy';

export async function readPolicy(): Promise<SitePolicy> {
  const stored = await browser.storage.local.get(SITE_POLICY_STORAGE_KEY);
  const policy = stored[SITE_POLICY_STORAGE_KEY];
  if (!isSitePolicy(policy)) return defaultPolicy;
  return policy;
}

export function writePolicy(policy: SitePolicy): Promise<void> {
  return browser.storage.local.set({ [SITE_POLICY_STORAGE_KEY]: policy });
}

function isSitePolicy(value: unknown): value is SitePolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Partial<SitePolicy>;
  return typeof policy.enabled === 'boolean' && Array.isArray(policy.allowlist)
    && policy.allowlist.every((entry) => typeof entry === 'string');
}
