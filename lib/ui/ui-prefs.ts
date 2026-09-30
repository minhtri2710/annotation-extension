import { browser } from 'wxt/browser';

export const TOOLBAR_PREFS_STORAGE_KEY = 'ui:toolbar';
export const TOOLBAR_HIDDEN_STORAGE_KEY = 'ui:toolbar-hidden';
export const ONBOARDING_OPEN_STORAGE_KEY = 'ui:onboarding-open';

export interface ToolbarPrefs {
  position: { x: number; y: number } | null;
  collapsed: boolean;
}

export const defaultToolbarPrefs: ToolbarPrefs = { position: null, collapsed: false };

export async function readToolbarPrefs(): Promise<ToolbarPrefs> {
  const stored = await browser.storage.local.get(TOOLBAR_PREFS_STORAGE_KEY);
  const prefs = stored[TOOLBAR_PREFS_STORAGE_KEY];
  if (!isToolbarPrefs(prefs)) return defaultToolbarPrefs;
  return prefs;
}

export function writeToolbarPrefs(prefs: ToolbarPrefs): Promise<void> {
  return browser.storage.local.set({ [TOOLBAR_PREFS_STORAGE_KEY]: prefs });
}

// Kept apart from ui:toolbar: every tab writes that whole object from its own copy, so a hidden flag inside
// it could be overwritten by another tab's collapse or move, and hiding could overwrite theirs.
export async function readToolbarHidden(): Promise<boolean> {
  const stored = await browser.storage.local.get(TOOLBAR_HIDDEN_STORAGE_KEY);
  return stored[TOOLBAR_HIDDEN_STORAGE_KEY] === true;
}

export function writeToolbarHidden(hidden: boolean): Promise<void> {
  return browser.storage.local.set({ [TOOLBAR_HIDDEN_STORAGE_KEY]: hidden });
}

export async function readOnboardingOpen(): Promise<boolean> {
  const stored = await browser.storage.local.get(ONBOARDING_OPEN_STORAGE_KEY);
  const open = stored[ONBOARDING_OPEN_STORAGE_KEY];
  return typeof open === 'boolean' ? open : true;
}

export function writeOnboardingOpen(open: boolean): Promise<void> {
  return browser.storage.local.set({ [ONBOARDING_OPEN_STORAGE_KEY]: open });
}

function isToolbarPrefs(value: unknown): value is ToolbarPrefs {
  if (!value || typeof value !== 'object') return false;
  const prefs = value as Partial<ToolbarPrefs>;
  if (typeof prefs.collapsed !== 'boolean') return false;
  if (prefs.position === null) return true;
  if (!prefs.position || typeof prefs.position !== 'object') return false;
  return Number.isFinite(prefs.position.x) && Number.isFinite(prefs.position.y);
}
