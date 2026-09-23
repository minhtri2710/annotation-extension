export interface SitePolicy {
  enabled: boolean;
  allowlist: string[];
}

export const defaultPolicy: SitePolicy = {
  enabled: true,
  allowlist: [],
};

/** Allowlist entries match URLs by exact hostname; ports and paths are ignored. */
export function isEnabledForUrl(url: string, policy: SitePolicy): boolean {
  if (!policy.enabled) return false;
  if (policy.allowlist.length === 0) return true;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return policy.allowlist.some((entry) => parseAllowlistEntry(entry) === hostname);
}

/** Returns the lowercase (punycode) hostname an entry matches, or undefined when it names no host. */
export function parseAllowlistEntry(entry: string): string | undefined {
  const value = entry.trim();
  if (!value) return undefined;

  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    return parsed.hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export function allowlistEntryError(entry: string): string | undefined {
  if (parseAllowlistEntry(entry)) return undefined;
  return `"${entry.trim()}" is not a valid site. Use a hostname like docs.example.com or a URL.`;
}
