import { describe, expect, it } from 'vitest';
import { OVERLAY_STYLES } from './styles';

describe('overlay styles', () => {
  it('defines the fixed toolbar chrome', () => {
    expect(OVERLAY_STYLES).toContain('[data-annotation-mount="toolbar"]');
    expect(OVERLAY_STYLES).toContain('position: fixed');
    expect(OVERLAY_STYLES).toContain('bottom: var(--annotation-space-4)');
    expect(OVERLAY_STYLES).toContain('right: var(--annotation-space-4)');
    expect(OVERLAY_STYLES).toContain('z-index: 2147483646');
  });

  it('defines the floating panel card and keeps existing tokens', () => {
    expect(OVERLAY_STYLES).toContain('[data-annotation-mount="panel"]');
    expect(OVERLAY_STYLES).toContain('background: var(--annotation-color-surface)');
    expect(OVERLAY_STYLES).toContain('border: 1px solid var(--annotation-color-border)');
    expect(OVERLAY_STYLES).toContain('border-radius: var(--annotation-radius-lg)');
    expect(OVERLAY_STYLES).toContain('box-shadow:');
    expect(OVERLAY_STYLES).toContain('max-height: calc(100vh - 2 * var(--annotation-space-4))');
    expect(OVERLAY_STYLES).toContain('--annotation-color-surface');
    expect(OVERLAY_STYLES).toContain('--annotation-space-4');
    expect(OVERLAY_STYLES).toContain('[data-theme="dark"]');
  });
});
