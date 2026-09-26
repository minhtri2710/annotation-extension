export const PAGE_KEY_PREFIX = 'page:';

export function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  if (parsed.search === '') parsed.search = '';
  return `${PAGE_KEY_PREFIX}${parsed.toString()}`;
}
