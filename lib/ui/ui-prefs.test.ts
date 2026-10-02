import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
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
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null });
  });

  it('round-trips toolbar prefs through storage.local under ui:toolbar as the position alone', async () => {
    await writeToolbarPrefs({ position: { x: 12, y: 34 } });
    await expect(fakeBrowser.storage.local.get('ui:toolbar')).resolves.toEqual({
      'ui:toolbar': { position: { x: 12, y: 34 } },
    });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: { x: 12, y: 34 } });
    await writeToolbarPrefs({ position: null });
    await expect(fakeBrowser.storage.local.get('ui:toolbar')).resolves.toEqual({ 'ui:toolbar': { position: null } });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null });
  });

  it.each([
    'bad',
    null,
    {},
    { position: { x: 1 } },
    { position: { x: Number.NaN, y: 1 } },
    { position: { x: 1, y: Number.POSITIVE_INFINITY } },
    { position: { x: '1', y: 2 } },
    { position: 5 },
  ])('returns the whole default for invalid stored toolbar prefs %#', async (value) => {
    await fakeBrowser.storage.local.set({ 'ui:toolbar': value });
    await expect(readToolbarPrefs()).resolves.toEqual({ position: null });
  });

  it('defaults onboarding to closed and round-trips it under ui:onboarding-open', async () => {
    await expect(readOnboardingOpen()).resolves.toBe(false);
    await writeOnboardingOpen(true);
    await expect(fakeBrowser.storage.local.get('ui:onboarding-open')).resolves.toEqual({ 'ui:onboarding-open': true });
    await expect(readOnboardingOpen()).resolves.toBe(true);
  });

  it('returns the closed onboarding default for a non-boolean stored value', async () => {
    await fakeBrowser.storage.local.set({ 'ui:onboarding-open': 'true' });
    await expect(readOnboardingOpen()).resolves.toBe(false);
  });
});
