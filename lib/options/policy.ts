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

  let hostname: string;
  try {
    hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  // Engines differ on what the URL parser rejects (Chromium percent-encodes `*` and spaces), so the grammar decides.
  return isHostname(hostname) ? hostname : undefined;
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DNS_NAME = new RegExp(`^(?:${LABEL}\\.)*${LABEL}$`);
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}$`);
const IPV6 = /^\[[0-9a-f:]*:[0-9a-f:]*\]$/;

/** LDH labels (IDNs arrive as punycode), a dotted IPv4 address, or a bracketed IPv6 address. */
function isHostname(hostname: string): boolean {
  if (IPV4.test(hostname) || IPV6.test(hostname)) return true;
  // A numeric last label would make the name an IPv4 address, which the check above already decided.
  return hostname.length <= 253 && DNS_NAME.test(hostname) && !/(?:^|\.)\d+$/.test(hostname);
}

export function allowlistEntryError(entry: string): string | undefined {
  if (parseAllowlistEntry(entry)) return undefined;
  return `"${entry.trim()}" is not a valid site. Use a hostname like docs.example.com or a URL.`;
}
