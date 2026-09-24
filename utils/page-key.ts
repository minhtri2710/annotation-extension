export const PAGE_KEY_PREFIX = 'page:';

export function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return `${PAGE_KEY_PREFIX}${parsed.toString()}`;
}
