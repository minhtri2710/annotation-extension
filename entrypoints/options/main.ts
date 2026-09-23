import {
  allowlistEntryError,
  defaultPolicy,
  parseAllowlistEntry,
  type SitePolicy,
} from '../../lib/options/policy';
import { readPolicy, writePolicy } from '../../lib/options/storage';
import { PAGE_STYLES } from '../../lib/ui/page-styles';

const pageStyle = document.createElement('style');
pageStyle.textContent = PAGE_STYLES;
document.head.append(pageStyle);

const enabledInput = document.querySelector<HTMLInputElement>('#enabled');
const allowlistForm = document.querySelector<HTMLFormElement>('#allowlist-form');
const allowlistEntry = document.querySelector<HTMLInputElement>('#allowlist-entry');
const allowlist = document.querySelector<HTMLUListElement>('#allowlist');
const saveButton = document.querySelector<HTMLButtonElement>('#save');
const entryError = document.querySelector<HTMLParagraphElement>('#allowlist-error');
const status = document.querySelector<HTMLParagraphElement>('#status');

let policy: SitePolicy = { ...defaultPolicy, allowlist: [] };

function renderAllowlist(): void {
  if (!allowlist) return;
  allowlist.replaceChildren(
    ...policy.allowlist.map((entry, index) => {
      const item = document.createElement('li');
      item.textContent = entry;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${entry}`);
      remove.addEventListener('click', () => {
        policy.allowlist = policy.allowlist.filter((_, entryIndex) => entryIndex !== index);
        renderAllowlist();
      });
      item.append(' ', remove);
      return item;
    }),
  );
}

allowlistForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = allowlistEntry?.value ?? '';
  if (!raw.trim()) return;
  const entry = parseAllowlistEntry(raw);
  if (entryError) entryError.textContent = allowlistEntryError(raw) ?? '';
  if (!entry || policy.allowlist.includes(entry)) return;
  policy.allowlist = [...policy.allowlist, entry];
  if (allowlistEntry) allowlistEntry.value = '';
  renderAllowlist();
});

enabledInput?.addEventListener('change', () => {
  policy.enabled = enabledInput.checked;
});

saveButton?.addEventListener('click', async () => {
  const invalid = policy.allowlist.find((entry) => allowlistEntryError(entry));
  if (invalid !== undefined) {
    if (status) status.textContent = allowlistEntryError(invalid) ?? '';
    return;
  }
  await writePolicy(policy);
  if (status) status.textContent = 'Settings saved.';
});

void readPolicy().then((stored) => {
  policy = { enabled: stored.enabled, allowlist: [...stored.allowlist] };
  if (enabledInput) enabledInput.checked = policy.enabled;
  renderAllowlist();
});
