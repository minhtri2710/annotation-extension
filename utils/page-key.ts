export function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return `page:${parsed.toString()}`;
}
