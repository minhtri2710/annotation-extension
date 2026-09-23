// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { mountOptionsPage, type OptionsPageElements } from './options-page';
import type { SitePolicy } from './policy';

function setup(stored: SitePolicy = { enabled: true, allowlist: [] }) {
  const html = `
    <input id="enabled" type="checkbox" />
    <form id="allowlist-form"><input id="allowlist-entry" /><button type="submit">Add site</button><p id="allowlist-error" role="alert"></p></form>
    <ul id="allowlist"></ul>
    <button id="save" type="button">Save settings</button>
    <p id="status"></p>`;
  document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.children);
  const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  const elements: OptionsPageElements = {
    enabled: get<HTMLInputElement>('#enabled'),
    form: get<HTMLFormElement>('#allowlist-form'),
    entry: get<HTMLInputElement>('#allowlist-entry'),
    entryError: get<HTMLParagraphElement>('#allowlist-error'),
    allowlist: get<HTMLUListElement>('#allowlist'),
    save: get<HTMLButtonElement>('#save'),
    status: get<HTMLParagraphElement>('#status'),
  };
  const storage = { read: vi.fn(async () => stored), write: vi.fn(async (_policy: SitePolicy) => {}) };
  const add = (value: string) => {
    elements.entry.value = value;
    elements.form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const entries = () => [...elements.allowlist.querySelectorAll('li')].map((item) => item.firstChild?.textContent);
  const save = async () => {
    elements.save.click();
    await vi.waitFor(() => expect(elements.status.textContent).not.toBe(''));
  };
  return { elements, storage, add, entries, save };
}

describe('options page', () => {
  it('shows the stored toggle and allowlist on mount', async () => {
    const { elements, storage, entries } = setup({ enabled: false, allowlist: ['a.example'] });
    await mountOptionsPage(elements, storage);
    expect(elements.enabled.checked).toBe(false);
    expect(entries()).toEqual(['a.example']);
  });

  it('adds a valid entry normalized to its hostname and clears the field', async () => {
    const { elements, storage, add, entries } = setup();
    await mountOptionsPage(elements, storage);
    add('  HTTPS://Docs.Example.com:8080/path ');
    expect(entries()).toEqual(['docs.example.com']);
    expect(elements.entry.value).toBe('');
    add('docs.example.com');
    expect(entries()).toEqual(['docs.example.com']);
  });

  it('alerts with the invalid entry named and adds nothing', async () => {
    const { elements, storage, add, entries } = setup();
    await mountOptionsPage(elements, storage);
    add('not a host');
    expect(elements.entryError.getAttribute('role')).toBe('alert');
    expect(elements.entryError.textContent).toBe('"not a host" is not a valid site. Use a hostname like docs.example.com or a URL.');
    expect(entries()).toEqual([]);
  });

  it('clears a visible error on an empty submit and adds nothing', async () => {
    const { elements, storage, add, entries } = setup();
    await mountOptionsPage(elements, storage);
    add('not a host');
    expect(elements.entryError.textContent).not.toBe('');
    add('   ');
    expect(elements.entryError.textContent).toBe('');
    expect(entries()).toEqual([]);
  });

  it('refuses to save while a stored entry is invalid, naming it', async () => {
    const { elements, storage, save } = setup({ enabled: true, allowlist: ['bad host'] });
    await mountOptionsPage(elements, storage);
    await save();
    expect(elements.status.textContent).toBe('"bad host" is not a valid site. Use a hostname like docs.example.com or a URL.');
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('rejects an entry outside the hostname grammar and saves nothing invalid', async () => {
    const { elements, storage, add, entries, save } = setup({ enabled: true, allowlist: ['%2a.example.com'] });
    await mountOptionsPage(elements, storage);
    add('under_score.example');
    expect(elements.entryError.textContent).toBe('"under_score.example" is not a valid site. Use a hostname like docs.example.com or a URL.');
    expect(entries()).toEqual(['%2a.example.com']);
    await save();
    expect(elements.status.textContent).toBe('"%2a.example.com" is not a valid site. Use a hostname like docs.example.com or a URL.');
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('saves the toggle and allowlist and says so', async () => {
    const { elements, storage, add, save } = setup();
    await mountOptionsPage(elements, storage);
    add('a.example');
    elements.enabled.checked = false;
    elements.enabled.dispatchEvent(new Event('change'));
    await save();
    expect(storage.write).toHaveBeenCalledWith({ enabled: false, allowlist: ['a.example'] });
    expect(elements.status.textContent).toBe('Settings saved.');
  });

  it('reports a failed save with its reason and never says saved', async () => {
    const { elements, storage, save } = setup();
    storage.write.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await mountOptionsPage(elements, storage);
    await save();
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(elements.status.textContent).toBe('Save failed: QUOTA_BYTES quota exceeded');
  });

  it('names each remove button after its entry and removes only that entry', async () => {
    const { elements, storage, entries } = setup({ enabled: true, allowlist: ['a.example', 'b.example'] });
    await mountOptionsPage(elements, storage);
    const buttons = [...elements.allowlist.querySelectorAll('button')];
    expect(buttons.map((button) => [button.textContent, button.getAttribute('aria-label')])).toEqual([
      ['Remove', 'Remove a.example'],
      ['Remove', 'Remove b.example'],
    ]);
    buttons[0]!.click();
    expect(entries()).toEqual(['b.example']);
  });
});
