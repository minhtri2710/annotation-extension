import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';

export const OVERLAY_STYLES = `
[data-annotation-shell] {
${ANNOTATION_TOKENS}

  box-sizing: border-box;
  color: var(--annotation-color-text);
  font-family: var(--annotation-font-family);
  font-size: var(--annotation-font-size-body);
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
  box-shadow: 0 4px 16px rgba(23, 32, 51, 0.2);
  pointer-events: auto;
}

[data-annotation-shell] [data-annotation-mount="toolbar"] {
  flex-wrap: wrap;
  max-width: calc(100% - 2 * var(--annotation-space-4));
}

[data-annotation-shell] [data-annotation-toolbar-grip] {
  cursor: grab;
  touch-action: none;
}

[data-annotation-shell] [data-annotation-toolbar-grip][data-dragging] {
  cursor: grabbing;
}

[data-annotation-shell] [data-annotation-mount="toolbar"][data-collapsed] > :not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-collapse]):not([data-annotation-badge]) {
  display: none;
}

[data-annotation-shell] [data-annotation-mount="panel"] {
  position: fixed;
  right: var(--annotation-space-4);
  bottom: calc(var(--annotation-space-4) + 56px);
  z-index: 2147483645;
  width: min(384px, calc(100% - 2 * var(--annotation-space-4)));
  max-height: calc(100vh - 2 * var(--annotation-space-4));
  overflow: auto;
  padding: var(--annotation-space-4);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-lg);
  background: var(--annotation-color-surface);
  box-shadow: 0 12px 32px rgba(23, 32, 51, 0.24);
  pointer-events: auto;
}

[data-annotation-shell] [data-annotation-mount="panel"] {
  overflow-wrap: anywhere;
}

[data-annotation-shell] [data-annotation-mount="panel"]:empty {
  display: none;
}

@keyframes annotation-panel-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

[data-annotation-shell] [data-annotation-badge] {
  font-weight: var(--annotation-font-weight-medium);
}

@keyframes annotation-badge-pop {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: none; }
}

[data-annotation-shell] [data-annotation-onboarding] {
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-md);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
}

[data-annotation-shell] [data-annotation-onboarding] ol {
  margin: var(--annotation-space-2) 0 0;
  padding-left: var(--annotation-space-4);
}

[data-annotation-shell] [data-annotation-empty-state] {
  margin: 0;
  padding: var(--annotation-space-4);
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
  text-align: center;
}

[data-annotation-shell] [data-annotation-mount="panel"] > * + * {
  margin-top: var(--annotation-space-3);
}

[data-annotation-shell] .annotation-pin[data-annotation-status="resolved"] {
  opacity: 0.55;
}

[data-annotation-shell] .annotation-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-bold);
}

[data-annotation-shell] .annotation-pin:hover {
  opacity: 1;
  outline: 2px solid var(--annotation-color-accent);
  outline-offset: 2px;
}

[data-annotation-shell] .annotation-pin:focus-visible {
  outline: 2px solid var(--annotation-color-text);
  outline-offset: 2px;
  box-shadow: 0 0 0 6px var(--annotation-color-surface);
}

[data-annotation-shell] .annotation-pin:active {
  opacity: 0.8;
}

[data-annotation-shell] .annotation-pin-tooltip {
  position: fixed;
  z-index: 2147483647;
  max-width: min(256px, calc(100% - 16px));
  padding: var(--annotation-space-1) var(--annotation-space-2);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-sm);
  background: var(--annotation-color-surface);
  color: var(--annotation-color-text);
  box-shadow: 0 4px 16px rgba(23, 32, 51, 0.2);
  font-size: var(--annotation-font-size-caption);
  line-height: 1.3;
  pointer-events: auto;
}

[data-annotation-shell] .annotation-pin-tooltip::before {
  content: "";
  position: absolute;
  inset: -8px;
  z-index: -1;
}

@keyframes annotation-tooltip-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes locate-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.18); }
}

[data-annotation-shell] [data-annotation-mount] button,
[data-annotation-shell] [data-annotation-mount] input,
[data-annotation-shell] [data-annotation-mount] textarea,
[data-annotation-shell] [data-annotation-mount] select {
  max-width: 100%;
}

[data-annotation-shell] [data-annotation-mount] button:hover {
  border-color: var(--annotation-color-accent);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text);
}

[data-annotation-shell] [data-annotation-mount] input:focus-visible,
[data-annotation-shell] [data-annotation-mount] textarea:focus-visible,
[data-annotation-shell] [data-annotation-mount] select:focus-visible {
  outline: 2px solid var(--annotation-color-accent);
  outline-offset: 2px;
}

[data-annotation-shell] [data-annotation-mount] button:focus-visible {
  outline: 2px solid var(--annotation-color-accent);
  outline-offset: 2px;
}

[data-annotation-shell] [data-annotation-scan-summary] {
  margin: 0;
  font-weight: var(--annotation-font-weight-medium);
}

[data-annotation-shell] [data-annotation-scan-group] {
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-border);
}

[data-annotation-shell] [data-annotation-scan-group] h3 {
  display: inline;
  margin: 0;
}

[data-annotation-shell] [data-annotation-scan-group] summary {
  margin: 0 0 var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-filter] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-filter] button[aria-pressed="true"] {
  border-color: var(--annotation-color-accent);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text);
  font-weight: var(--annotation-font-weight-medium);
}

[data-annotation-shell] [data-annotation-scan-group] p,
[data-annotation-shell] [data-annotation-scan-group] ul {
  margin: 0 0 var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-scan-group] ul {
  padding-left: var(--annotation-space-4);
}

[data-annotation-shell] [data-annotation-scan-finding] {
  font-size: var(--annotation-font-size-caption);
  overflow-wrap: anywhere;
}

[data-annotation-shell] [data-annotation-severity] {
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-bold);
}

[data-annotation-shell] [data-annotation-severity="error"] {
  color: var(--annotation-color-danger);
}

[data-annotation-shell] [data-annotation-severity="warning"] {
  color: var(--annotation-color-warning);
}

[data-annotation-shell] [data-annotation-severity="advisory"] {
  color: var(--annotation-color-text-muted);
}

[data-annotation-shell] [data-annotation-scan-highlight] {
  z-index: 2147483644;
  outline: 2px solid var(--annotation-color-accent);
  box-shadow: 0 0 0 4px var(--annotation-color-surface);
  pointer-events: none;
}

[data-annotation-shell] [data-annotation-live] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

[data-annotation-shell] [data-annotation-badge-unit] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

[data-annotation-shell] [data-annotation-position] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--annotation-space-4);
  padding: 0 var(--annotation-space-1);
  border-radius: var(--annotation-radius-sm);
  background: var(--annotation-color-accent);
  color: var(--annotation-color-surface);
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-bold);
}

[data-annotation-shell] [data-annotation-hint] {
  margin: 0;
  overflow: hidden;
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-annotation-shell] summary {
  color: var(--annotation-color-text);
  font-weight: var(--annotation-font-weight-medium);
  cursor: pointer;
}

[data-annotation-shell] [data-annotation-unsaved] {
  margin: 0;
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
}

[data-annotation-shell] [data-annotation-row] [data-annotation-status] {
  display: inline-block;
  margin: 0;
  padding: 0 var(--annotation-space-2);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-sm);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-medium);
}

[data-annotation-shell] [data-annotation-row] [data-annotation-status="open"] {
  border-color: var(--annotation-color-accent);
  color: var(--annotation-color-text);
}

[data-annotation-shell] [data-annotation-locate-missing] {
  margin: 0;
  color: var(--annotation-color-danger);
  font-size: var(--annotation-font-size-caption);
}

[data-annotation-shell] [data-annotation-clear-prompt] {
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 1px solid var(--annotation-color-danger);
  border-radius: var(--annotation-radius-md);
}

@media (prefers-reduced-motion: no-preference) {
  [data-annotation-shell] [data-annotation-mount="panel"]:not(:empty) {
    animation: annotation-panel-enter 160ms ease-out;
  }

  [data-annotation-shell] [data-annotation-badge] {
    animation: annotation-badge-pop 150ms ease-out;
  }

  [data-annotation-shell] .annotation-pin {
    transition: opacity 120ms ease-out;
  }

  [data-annotation-shell] .annotation-pin-tooltip {
    animation: annotation-tooltip-fade-in 120ms ease-out;
  }

  [data-annotation-shell] .locate-pulse {
    animation: locate-pulse 500ms ease-out;
  }

  [data-annotation-shell] [data-annotation-mount] button {
    transition: color 120ms ease-out, background 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
  }

  [data-annotation-shell] [data-annotation-mount] button:active {
    transform: translateY(1px);
  }
}

[data-annotation-shell] [data-annotation-mount] button:active {
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text);
}
`;
