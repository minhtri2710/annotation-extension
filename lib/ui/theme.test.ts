import { describe, expect, it } from 'vitest';
import { resolveThemeMode } from './theme';

describe('theme mode resolver', () => {
  it('keeps an explicit light mode', () => {
    expect(resolveThemeMode('light', () => true)).toBe('light');
  });

  it('keeps an explicit dark mode', () => {
    expect(resolveThemeMode('dark', () => false)).toBe('dark');
  });

  it('resolves system mode from the injected prefers-color-scheme signal', () => {
    expect(resolveThemeMode('system', () => true)).toBe('dark');
    expect(resolveThemeMode('system', () => false)).toBe('light');
  });

  it('falls back to light when the system signal is unavailable', () => {
    expect(resolveThemeMode('system')).toBe('light');
    expect(resolveThemeMode('system', () => undefined)).toBe('light');
  });
});
