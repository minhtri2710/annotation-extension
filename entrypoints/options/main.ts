import { mountOptionsPage } from '../../lib/options/options-page';
import { readPolicy, writePolicy } from '../../lib/options/storage';
import { PAGE_STYLES } from '../../lib/ui/page-styles';

const pageStyle = document.createElement('style');
pageStyle.textContent = PAGE_STYLES;
document.head.append(pageStyle);

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Options page is missing ${selector}`);
  return element;
}

void mountOptionsPage(
  {
    enabled: required<HTMLInputElement>('#enabled'),
    form: required<HTMLFormElement>('#allowlist-form'),
    entry: required<HTMLInputElement>('#allowlist-entry'),
    entryError: required<HTMLParagraphElement>('#allowlist-error'),
    allowlist: required<HTMLUListElement>('#allowlist'),
    save: required<HTMLButtonElement>('#save'),
    status: required<HTMLParagraphElement>('#status'),
  },
  { read: readPolicy, write: writePolicy },
);
