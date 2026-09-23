import { pageKey } from '../../utils/page-key';

// A page's own pushState/replaceState fires no event this world can see, so the URL is also
// re-checked on an interval; the check compares strings only.
export const ROUTE_POLL_MS = 500;

export function watchRoute(win: Window, onChange: (url: string) => void): () => void {
  let lastUrl = win.location.href;
  let lastKey = pageKey(lastUrl);

  const check = () => {
    const url = win.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    const key = pageKey(url);
    if (key === lastKey) return;
    lastKey = key;
    onChange(url);
  };

  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  const observer = new MutationObserver(check);
  observer.observe(win.document.head ?? win.document.documentElement, { childList: true, subtree: true, characterData: true });
  const poll = win.setInterval(check, ROUTE_POLL_MS);

  return () => {
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
    observer.disconnect();
    win.clearInterval(poll);
  };
}
