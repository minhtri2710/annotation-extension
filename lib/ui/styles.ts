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

[data-annotation-shell] [data-annotation-mount="panel"]:empty {
  display: none;
}

[data-annotation-shell] [data-annotation-mount="panel"] > * + * {
  margin-top: var(--annotation-space-3);
}

[data-annotation-shell] .annotation-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
}

[data-annotation-shell] .annotation-pin-tooltip {
  position: fixed;
  z-index: 2147483647;
  max-width: 16rem;
  padding: var(--annotation-space-1) var(--annotation-space-2);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-sm);
  background: var(--annotation-color-surface);
  color: var(--annotation-color-text);
  box-shadow: 0 0.25rem 1rem rgba(23, 32, 51, 0.2);
  font-size: 0.75rem;
  line-height: 1.3;
  pointer-events: none;
  animation: annotation-tooltip-fade-in 120ms ease-out;
}

@keyframes annotation-tooltip-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes locate-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.18); }
}

[data-annotation-shell] .locate-pulse {
  animation: locate-pulse 500ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  [data-annotation-shell] .annotation-pin-tooltip,
  [data-annotation-shell] .locate-pulse {
    animation: none;
  }
}

[data-annotation-shell] [data-annotation-mount] button,
[data-annotation-shell] [data-annotation-mount] input,
[data-annotation-shell] [data-annotation-mount] textarea,
[data-annotation-shell] [data-annotation-mount] select {
  max-width: 100%;
}
`;
