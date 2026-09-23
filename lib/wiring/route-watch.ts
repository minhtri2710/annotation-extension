import { pageKey } from '../../utils/page-key';

export function watchRoute(win: Window, onChange: (url: string) => void): () => void {
  let lastKey = pageKey(win.location.href);

  const check = () => {
    const url = win.location.href;
    const key = pageKey(url);
    if (key === lastKey) return;
    lastKey = key;
    onChange(url);
  };

  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  const observer = new MutationObserver(check);
  observer.observe(win.document.head ?? win.document.documentElement, { childList: true, subtree: true, characterData: true });

  return () => {
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
    observer.disconnect();
  };
}
