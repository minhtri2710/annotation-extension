import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  ONBOARDING_OPEN_STORAGE_KEY,
  TOOLBAR_PREFS_STORAGE_KEY,
  readOnboardingOpen,
  readToolbarPrefs,
  writeOnboardingOpen,
  writeToolbarPrefs,
} from './ui-prefs';

afterEach(() => {
  fakeBrowser.reset();
});

describe('ui prefs', () => {
  it('defaults the toolbar prefs when nothing is stored', async () => {
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null, collapsed: false });
  });

  it('round-trips toolbar prefs through storage.local under ui:toolbar', async () => {
    await writeToolbarPrefs({ position: { x: 12, y: 34 }, collapsed: true });
    expect(TOOLBAR_PREFS_STORAGE_KEY).toBe('ui:toolbar');
    await expect(fakeBrowser.storage.local.get('ui:toolbar')).resolves.toEqual({
      'ui:toolbar': { position: { x: 12, y: 34 }, collapsed: true },
    });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: { x: 12, y: 34 }, collapsed: true });
    await writeToolbarPrefs({ position: null, collapsed: false });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null, collapsed: false });
  });

  it.each([
    'bad',
    null,
    { collapsed: true },
    { position: null },
    { position: null, collapsed: 'yes' },
    { position: { x: 1 }, collapsed: true },
    { position: { x: Number.NaN, y: 1 }, collapsed: true },
    { position: { x: 1, y: Number.POSITIVE_INFINITY }, collapsed: false },
    { position: { x: '1', y: 2 }, collapsed: true },
    { position: 5, collapsed: true },
  ])('returns the whole default for invalid stored toolbar prefs %#', async (value) => {
    await fakeBrowser.storage.local.set({ 'ui:toolbar': value });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null, collapsed: false });
  });

  it('defaults onboarding to open and round-trips it under ui:onboarding-open', async () => {
    await expect(readOnboardingOpen()).resolves.toBe(true);
    await writeOnboardingOpen(false);
    expect(ONBOARDING_OPEN_STORAGE_KEY).toBe('ui:onboarding-open');
    await expect(fakeBrowser.storage.local.get('ui:onboarding-open')).resolves.toEqual({ 'ui:onboarding-open': false });
    await expect(readOnboardingOpen()).resolves.toBe(false);
  });

  it('returns the onboarding default for a non-boolean stored value', async () => {
    await fakeBrowser.storage.local.set({ 'ui:onboarding-open': 'false' });
    await expect(readOnboardingOpen()).resolves.toBe(true);
  });
});
