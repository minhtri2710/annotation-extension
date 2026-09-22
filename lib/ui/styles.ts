export const OVERLAY_STYLES = `
[data-annotation-shell] {
  --annotation-color-surface: #ffffff;
  --annotation-color-surface-raised: #f5f7fa;
  --annotation-color-text: #172033;
  --annotation-color-text-muted: #5d687a;
  --annotation-color-border: #d7dde7;
  --annotation-color-accent: #2f6fed;
  --annotation-space-1: 0.25rem;
  --annotation-space-2: 0.5rem;
  --annotation-space-3: 0.75rem;
  --annotation-space-4: 1rem;
  --annotation-radius-sm: 0.25rem;
  --annotation-radius-md: 0.5rem;
  --annotation-radius-lg: 0.75rem;
  --annotation-font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --annotation-font-size: 0.875rem;
  --annotation-line-height: 1.4;

  box-sizing: border-box;
  color: var(--annotation-color-text);
  font-family: var(--annotation-font-family);
  font-size: var(--annotation-font-size);
  line-height: var(--annotation-line-height);
}

[data-annotation-shell][data-theme="dark"] {
  --annotation-color-surface: #1b2230;
  --annotation-color-surface-raised: #252e3e;
  --annotation-color-text: #f1f4f8;
  --annotation-color-text-muted: #aab5c5;
  --annotation-color-border: #3b475b;
  --annotation-color-accent: #80aaff;
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
