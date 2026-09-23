import { allowlistEntryError, defaultPolicy, parseAllowlistEntry, type SitePolicy } from './policy';

export interface OptionsPageElements {
  enabled: HTMLInputElement;
  form: HTMLFormElement;
  entry: HTMLInputElement;
  entryError: HTMLElement;
  allowlist: HTMLUListElement;
  save: HTMLButtonElement;
  status: HTMLElement;
}

export interface PolicyStorage {
  read(): Promise<SitePolicy>;
  write(policy: SitePolicy): Promise<void>;
}

/** Wires the options page; resolves once the stored policy is shown. */
export async function mountOptionsPage(elements: OptionsPageElements, storage: PolicyStorage): Promise<void> {
  const { enabled, form, entry, entryError, allowlist, save, status } = elements;
  let policy: SitePolicy = { ...defaultPolicy, allowlist: [] };

  function renderAllowlist(): void {
    allowlist.replaceChildren(
      ...policy.allowlist.map((value, index) => {
        const item = document.createElement('li');
        item.textContent = value;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${value}`);
        remove.addEventListener('click', () => {
          policy.allowlist = policy.allowlist.filter((_, entryIndex) => entryIndex !== index);
          renderAllowlist();
        });
        item.append(' ', remove);
        return item;
      }),
    );
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = entry.value;
    if (!raw.trim()) {
      entryError.textContent = '';
      return;
    }
    const parsed = parseAllowlistEntry(raw);
    entryError.textContent = allowlistEntryError(raw) ?? '';
    if (!parsed || policy.allowlist.includes(parsed)) return;
    policy.allowlist = [...policy.allowlist, parsed];
    entry.value = '';
    renderAllowlist();
  });

  enabled.addEventListener('change', () => {
    policy.enabled = enabled.checked;
  });

  save.addEventListener('click', async () => {
    const invalid = policy.allowlist.find((value) => allowlistEntryError(value));
    if (invalid !== undefined) {
      status.textContent = allowlistEntryError(invalid) ?? '';
      return;
    }
    await storage.write(policy);
    status.textContent = 'Settings saved.';
  });

  const stored = await storage.read();
  policy = { enabled: stored.enabled, allowlist: [...stored.allowlist] };
  enabled.checked = policy.enabled;
  renderAllowlist();
}
