import { errorMessage } from '../guards';
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
  let saved = JSON.stringify(policy);
  let dirty = false;

  // Shows "Unsaved changes" while the edited policy differs from the stored one; leaving then prompts.
  function trackChanges(): void {
    const next = JSON.stringify(policy) !== saved;
    if (next) status.textContent = 'Unsaved changes';
    else if (dirty) status.textContent = '';
    dirty = next;
  }

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
          trackChanges();
          const buttons = allowlist.querySelectorAll('button');
          (buttons[index] ?? buttons[index - 1] ?? entry).focus();
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
    trackChanges();
  });

  enabled.addEventListener('change', () => {
    policy.enabled = enabled.checked;
    trackChanges();
  });

  save.addEventListener('click', async () => {
    const invalid = policy.allowlist.find((value) => allowlistEntryError(value));
    if (invalid !== undefined) {
      status.textContent = allowlistEntryError(invalid) ?? '';
      return;
    }
    const written = JSON.stringify(policy);
    try {
      await storage.write(policy);
    } catch (error) {
      status.textContent = `Save failed: ${errorMessage(error)}`;
      return;
    }
    saved = written;
    trackChanges();
    status.textContent = dirty ? 'Unsaved changes' : 'Settings saved.';
  });

  form.ownerDocument.defaultView!.onbeforeunload = (event) => {
    if (dirty) event.preventDefault();
  };

  const stored = await storage.read();
  policy = { enabled: stored.enabled, allowlist: [...stored.allowlist] };
  saved = JSON.stringify(policy);
  enabled.checked = policy.enabled;
  renderAllowlist();
}
