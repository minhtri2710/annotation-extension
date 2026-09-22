import { defaultPolicy, type SitePolicy } from '../../lib/options/policy';
import { readPolicy, writePolicy } from '../../lib/options/storage';

const enabledInput = document.querySelector<HTMLInputElement>('#enabled');
const allowlistForm = document.querySelector<HTMLFormElement>('#allowlist-form');
const allowlistEntry = document.querySelector<HTMLInputElement>('#allowlist-entry');
const allowlist = document.querySelector<HTMLUListElement>('#allowlist');
const saveButton = document.querySelector<HTMLButtonElement>('#save');
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
  const entry = allowlistEntry?.value.trim();
  if (!entry || policy.allowlist.includes(entry)) return;
  policy.allowlist = [...policy.allowlist, entry];
  if (allowlistEntry) allowlistEntry.value = '';
  renderAllowlist();
});

enabledInput?.addEventListener('change', () => {
  policy.enabled = enabledInput.checked;
});

saveButton?.addEventListener('click', async () => {
  await writePolicy(policy);
  if (status) status.textContent = 'Settings saved.';
});

void readPolicy().then((stored) => {
  policy = { enabled: stored.enabled, allowlist: [...stored.allowlist] };
  if (enabledInput) enabledInput.checked = policy.enabled;
  renderAllowlist();
});
