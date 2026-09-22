import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';

export const OVERLAY_STYLES = `
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
