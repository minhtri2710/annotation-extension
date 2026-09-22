import { describe, expect, it } from 'vitest';
import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';
import { OVERLAY_STYLES } from './styles';

describe('overlay styles', () => {
  it('defines the fixed toolbar chrome', () => {
    expect(OVERLAY_STYLES).toContain('[data-annotation-mount="toolbar"]');
    expect(OVERLAY_STYLES).toContain('position: fixed');
    expect(OVERLAY_STYLES).toContain('bottom: var(--annotation-space-4)');
    expect(OVERLAY_STYLES).toContain('right: var(--annotation-space-4)');
    expect(OVERLAY_STYLES).toContain('z-index: 2147483646');
  });

  it('recomposes the original stylesheet byte-for-byte with the extracted tokens', () => {
    const expected = `
[data-annotation-shell] {
${ANNOTATION_TOKENS}

  box-sizing: border-box;
  color: var(--annotation-color-text);
  font-family: var(--annotation-font-family);
  font-size: var(--annotation-font-size);
  line-height: var(--annotation-line-height);
}

[data-annotation-shell][data-theme="dark"] {
${ANNOTATION_DARK_TOKENS}
}

[data-annotation-shell] *,
[data-annotation-shell] *::before,
[data-annotation-shell] *::after {
  box-sizing: inherit;
}

[data-annotation-shell] [data-annotation-mount="toolbar"],
[data-annotation-shell] [data-annotation-mount="panel"] {
  display: block;
}

[data-annotation-shell] [data-annotation-mount="toolbar"] {
  position: fixed;
  right: var(--annotation-space-4);
  bottom: var(--annotation-space-4);
  z-index: 2147483646;
  display: flex;
  gap: var(--annotation-space-2);
  align-items: center;
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-lg);
  background: var(--annotation-color-surface);
  box-shadow: 0 0.25rem 1rem rgba(23, 32, 51, 0.2);
  pointer-events: auto;
}

[data-annotation-shell] [data-annotation-mount="panel"] {
  position: fixed;
  right: var(--annotation-space-4);
  bottom: calc(var(--annotation-space-4) + 3.5rem);
  z-index: 2147483645;
  width: min(24rem, calc(100vw - 2 * var(--annotation-space-4)));
  max-height: calc(100vh - 2 * var(--annotation-space-4));
  overflow: auto;
  padding: var(--annotation-space-4);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-lg);
  background: var(--annotation-color-surface);
  box-shadow: 0 0.75rem 2rem rgba(23, 32, 51, 0.24);
  pointer-events: auto;
}

[data-annotation-shell] [data-annotation-mount] > * + * {
  margin-top: var(--annotation-space-3);
}

[data-annotation-shell] [data-annotation-mount] button,
[data-annotation-shell] [data-annotation-mount] input,
[data-annotation-shell] [data-annotation-mount] textarea,
[data-annotation-shell] [data-annotation-mount] select {
  max-width: 100%;
}
`;

    expect(OVERLAY_STYLES).toBe(expected);

    const declarations = OVERLAY_STYLES.match(/--annotation-[a-z0-9-]+(?=:)/g) ?? [];
    expect(declarations).toHaveLength(22);
    expect(new Set(declarations)).toEqual(
      new Set([
        ...Object.keys({
          '--annotation-color-surface': true,
          '--annotation-color-surface-raised': true,
          '--annotation-color-text': true,
          '--annotation-color-text-muted': true,
          '--annotation-color-border': true,
          '--annotation-color-accent': true,
          '--annotation-space-1': true,
          '--annotation-space-2': true,
          '--annotation-space-3': true,
          '--annotation-space-4': true,
          '--annotation-radius-sm': true,
          '--annotation-radius-md': true,
          '--annotation-radius-lg': true,
          '--annotation-font-family': true,
          '--annotation-font-size': true,
          '--annotation-line-height': true,
        }),
      ]),
    );
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
