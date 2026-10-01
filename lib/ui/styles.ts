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

/* Every toolbar control, the count included, is one 32px high box on one line. */
[data-annotation-shell] [data-annotation-mount="toolbar"] > * {
  height: 32px;
  white-space: nowrap;
}

[data-annotation-shell] [data-annotation-toolbar-grip] {
  cursor: grab;
  touch-action: none;
}

[data-annotation-shell] [data-annotation-toolbar-grip][data-dragging] {
  cursor: grabbing;
}

[data-annotation-shell] [data-annotation-mount="toolbar"][hidden] {
  display: none;
}

[data-annotation-shell] [data-annotation-mount="toolbar"][data-collapsed] > :not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-collapse]):not([data-annotation-list-toggle]) {
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

/* The count sits on the View all button's top-right corner; it is not a toolbar item. */
[data-annotation-shell] [data-annotation-list-toggle] {
  position: relative;
}

[data-annotation-shell] [data-annotation-badge] {
  position: absolute;
  top: -6px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--annotation-space-1);
  border-radius: 9px;
  background: var(--annotation-color-accent);
  color: var(--annotation-color-on-accent);
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-bold);
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}

[data-annotation-shell] [data-annotation-badge][hidden] {
  display: none;
}

/* The badge shows the number; the unit stays in the text for assistive technology. */
[data-annotation-shell] [data-annotation-badge-unit] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: pre;
}

@keyframes annotation-badge-pop {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: none; }
}

[data-annotation-shell] [data-annotation-onboarding] {
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border-radius: var(--annotation-radius-md);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
}

[data-annotation-shell] [data-annotation-onboarding][hidden] {
  display: none;
}

[data-annotation-shell] [data-annotation-onboarding] ol {
  margin: 0;
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

/* Header: pin number, the element label on one truncated line, Close. The "Notes" heading stays in the tree for assistive technology. */
[data-annotation-shell] [data-annotation-note-header],
[data-annotation-shell] [data-annotation-list-header],
[data-annotation-shell] [data-annotation-scan-header] {
  display: flex;
  gap: var(--annotation-space-2);
  align-items: center;
}

/* The header stays in view while the panel body scrolls: it takes the panel's top padding, so no content shows above it. */
[data-annotation-shell] [data-annotation-mount="panel"]:has(> [data-annotation-note-header], > [data-annotation-list-header], > [data-annotation-scan-header]) {
  padding-top: 0;
}

[data-annotation-shell] [data-annotation-note-header],
[data-annotation-shell] [data-annotation-list-header],
[data-annotation-shell] [data-annotation-scan-header] {
  position: sticky;
  top: 0;
  z-index: 1;
  padding-top: var(--annotation-space-4);
  background: var(--annotation-color-surface);
}

[data-annotation-shell] [data-annotation-note-header] h2 {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

[data-annotation-shell] [data-annotation-note-header] [data-annotation-hint] {
  flex: 1 1 auto;
  min-width: 0;
}

[data-annotation-shell] [data-annotation-list-header] h2,
[data-annotation-shell] [data-annotation-scan-header] h2 {
  margin: 0;
  font-size: var(--annotation-font-size-title);
  font-weight: var(--annotation-font-weight-bold);
  line-height: 1.2;
}

[data-annotation-shell] [data-annotation-list-count] {
  flex: 1 1 auto;
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
}

[data-annotation-shell] [data-annotation-note-header] > [data-annotation-close],
[data-annotation-shell] [data-annotation-list-header] > [data-annotation-close],
[data-annotation-shell] [data-annotation-scan-header] > [data-annotation-close] {
  margin-left: auto;
}

[data-annotation-shell] [data-annotation-close],
[data-annotation-shell] [data-annotation-help] {
  width: 32px;
  min-width: 32px;
  padding: 0;
  font-size: var(--annotation-font-size-title);
  line-height: 1;
}

[data-annotation-shell] [data-annotation-help][aria-expanded="true"] {
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-accent);
}

/* Cards share the panel's one padding; a divider, not a box, separates two of them. */
[data-annotation-shell] article[data-annotation-note-card] {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-2);
}

[data-annotation-shell] article[data-annotation-note-card] + article[data-annotation-note-card] {
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

[data-annotation-shell] [data-annotation-note-actions],
[data-annotation-shell] [data-annotation-media-actions],
[data-annotation-shell] [data-annotation-group-actions],
[data-annotation-shell] [data-annotation-row-actions],
[data-annotation-shell] [data-annotation-export-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--annotation-space-2);
  align-items: center;
}

[data-annotation-shell] [data-annotation-media-actions] {
  gap: var(--annotation-space-1);
}

[data-annotation-shell] [data-annotation-note-actions] label[data-annotation-attach],
[data-annotation-shell] [data-annotation-media-actions] label[data-annotation-attach] {
  display: inline-flex;
  align-items: center;
}

[data-annotation-shell] [data-annotation-media-actions] label[data-annotation-attach]:has(input:focus-visible) {
  outline: 2px solid var(--annotation-color-accent);
  outline-offset: 2px;
}

/* Footer: Delete at the start, then the save status, Resolve and Save at the end, on one row; the delete prompt takes a row of its own. */
[data-annotation-shell] [data-annotation-note-actions] {
  flex-wrap: nowrap;
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

[data-annotation-shell] [data-annotation-note-actions] > [data-annotation-unsaved] {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
}

[data-annotation-shell] [data-annotation-note-actions] > [data-annotation-unsaved][hidden] {
  display: block;
  visibility: hidden;
}

[data-annotation-shell] [data-annotation-note-actions]:has(> [data-annotation-delete-prompt]) {
  flex-wrap: wrap;
}

[data-annotation-shell] [data-annotation-note-actions] > [data-annotation-delete-prompt] {
  flex-basis: 100%;
}

[data-annotation-shell] [data-annotation-mount="panel"] > [data-annotation-add-another] {
  align-self: flex-start;
}

[data-annotation-shell] [data-annotation-mount="panel"] > form[hidden] {
  display: none;
}

[data-annotation-shell] [data-annotation-attach-name]:empty {
  display: none;
}

[data-annotation-shell] [data-annotation-attachment-input] {
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

[data-annotation-shell] [data-annotation-attach-name] {
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
  overflow-wrap: anywhere;
}

[data-annotation-shell] [data-annotation-css-group],
[data-annotation-shell] [data-annotation-repro-group] {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-2);
}

[data-annotation-shell] article[data-annotation-note-card] summary {
  min-height: 32px;
  line-height: 32px;
}

[data-annotation-shell] article[data-annotation-note-card] label:has(textarea) {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-1);
}

[data-annotation-shell] [data-annotation-mount="panel"] textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: calc(3 * 1.4em + 2 * var(--annotation-space-1) + 2px);
  resize: vertical;
}

/* The note is the main field of its card, so it is taller than the CSS and repro fields, which keep the 3-line floor above. */
[data-annotation-shell] textarea[data-annotation-edit-note] {
  min-height: calc(4 * 1.4em + 2 * var(--annotation-space-1) + 2px);
}

[data-annotation-shell] [data-annotation-mount="panel"] > form {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-mount="panel"] > form label {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-1);
}

[data-annotation-shell] [data-annotation-mount="panel"]:has(article[data-annotation-note-card]) > form {
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

[data-annotation-shell] [data-annotation-mount="panel"] textarea::placeholder {
  color: var(--annotation-color-text-muted);
  opacity: 1;
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

[data-annotation-shell] .annotation-pin[hidden] {
  display: none;
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

:where([data-annotation-shell] [data-annotation-mount]) button,
:where([data-annotation-shell] [data-annotation-mount]) label[data-annotation-attach] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--annotation-space-1);
  max-width: 100%;
  min-height: 32px;
  padding: var(--annotation-space-1) var(--annotation-space-3);
  border: 0;
  border-radius: var(--annotation-radius-md);
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-text);
  font: inherit;
  cursor: pointer;
  appearance: none;
}

[data-annotation-shell] [data-annotation-mount] input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),
[data-annotation-shell] [data-annotation-mount] textarea,
[data-annotation-shell] [data-annotation-mount] select {
  max-width: 100%;
  padding: var(--annotation-space-1) var(--annotation-space-2);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-md);
  background: var(--annotation-color-surface);
  color: var(--annotation-color-text);
  font: inherit;
}

[data-annotation-shell] [data-annotation-mount] input {
  max-width: 100%;
}

/* Three tiers, none with a border. Secondary is the base: a neutral fill. */
[data-annotation-shell] [data-annotation-mount] button:hover,
[data-annotation-shell] [data-annotation-mount] label[data-annotation-attach]:hover {
  background: var(--annotation-color-hover);
  color: var(--annotation-color-text);
}

/* Primary: the one accent fill of a surface. */
[data-annotation-shell] [data-annotation-mount] button[data-variant="primary"],
[data-annotation-shell] [data-annotation-mount] button[data-variant="primary"]:hover,
[data-annotation-shell] [data-annotation-mount] button[data-variant="primary"]:active {
  background: var(--annotation-color-accent);
  color: var(--annotation-color-on-accent);
  font-weight: var(--annotation-font-weight-medium);
}

[data-annotation-shell] [data-annotation-mount] button[data-variant="primary"]:hover,
[data-annotation-shell] [data-annotation-mount] [role="group"] > button[data-variant="danger"]:hover {
  filter: brightness(0.92);
}

/* Ghost: transparent and muted until hovered. */
[data-annotation-shell] [data-annotation-mount] button[data-variant="quiet"],
[data-annotation-shell] [data-annotation-mount] label[data-annotation-attach],
[data-annotation-shell] [data-annotation-mount="toolbar"] > button:not([data-variant]),
[data-annotation-shell] [data-annotation-mount] button[data-annotation-close],
[data-annotation-shell] [data-annotation-filter] button {
  background: transparent;
  color: var(--annotation-color-text-muted);
}

[data-annotation-shell] [data-annotation-mount] button[data-variant="quiet"]:hover,
[data-annotation-shell] [data-annotation-mount] button[data-variant="quiet"]:active,
[data-annotation-shell] [data-annotation-mount] label[data-annotation-attach]:hover,
[data-annotation-shell] [data-annotation-mount="toolbar"] > button:not([data-variant]):hover,
[data-annotation-shell] [data-annotation-mount] button[data-annotation-close]:hover,
[data-annotation-shell] [data-annotation-filter] button:hover {
  background: var(--annotation-color-hover);
  color: var(--annotation-color-text);
}

/* A toggled icon control and a pressed segment read as selected through the accent. */
[data-annotation-shell] [data-annotation-mount="toolbar"] > button[aria-expanded="true"],
[data-annotation-shell] [data-annotation-mount] button[data-annotation-help][aria-expanded="true"] {
  background: var(--annotation-color-surface-raised);
  color: var(--annotation-color-accent);
}

/* Danger: red text on a transparent base; only a confirm button is filled. */
[data-annotation-shell] [data-annotation-mount] button[data-variant="danger"],
[data-annotation-shell] [data-annotation-mount] button[data-variant="danger"]:active {
  background: transparent;
  color: var(--annotation-color-danger);
}

[data-annotation-shell] [data-annotation-mount] button[data-variant="danger"]:hover {
  background: var(--annotation-color-hover);
  color: var(--annotation-color-danger);
}

[data-annotation-shell] [data-annotation-mount] [role="group"] > button[data-variant="danger"],
[data-annotation-shell] [data-annotation-mount] [role="group"] > button[data-variant="danger"]:hover,
[data-annotation-shell] [data-annotation-mount] [role="group"] > button[data-variant="danger"]:active {
  background: var(--annotation-color-danger);
  color: var(--annotation-color-on-accent);
  font-weight: var(--annotation-font-weight-medium);
}

/* Icon-only controls are square. */
[data-annotation-shell] [data-annotation-mount] button:has(> svg) {
  width: 32px;
  min-width: 32px;
  padding: 0;
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

/* Adjacent buttons keep a token gap, also where the row wraps. */
[data-annotation-shell] [data-annotation-deep-scan],
[data-annotation-shell] [data-annotation-rescan] {
  margin: 0 var(--annotation-space-2) var(--annotation-space-2) 0;
}

[data-annotation-shell] [data-annotation-deep-scan],
[data-annotation-shell] [data-annotation-rescan],
[data-annotation-shell] [data-annotation-scan-finding] button {
  height: 28px;
  min-height: 28px;
  padding-block: 0;
}

[data-annotation-shell] [data-annotation-mount="panel"] [data-annotation-scan-finding] button[data-annotation-scan-locate] {
  width: 28px;
  min-width: 28px;
  padding: 0;
}

[data-annotation-shell] [data-annotation-scan-group] {
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

[data-annotation-shell] [data-annotation-scan-group] h3 {
  display: inline;
  margin: 0;
}

[data-annotation-shell] [data-annotation-scan-group] summary {
  margin: 0 0 var(--annotation-space-2);
}

/* One segmented control: a neutral track with the pressed segment ringed in the accent. */
[data-annotation-shell] [data-annotation-filter] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--annotation-space-2);
  padding: 2px;
  border-radius: var(--annotation-radius-md);
  background: var(--annotation-color-surface-raised);
}

[data-annotation-shell] [data-annotation-filter] button {
  flex: 1 1 0;
  min-height: 28px;
  padding: 0 var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-filter] button[aria-pressed="true"] {
  box-shadow: inset 0 0 0 1px var(--annotation-color-accent);
  background: var(--annotation-color-surface);
  color: var(--annotation-color-accent);
  font-weight: var(--annotation-font-weight-medium);
}

[data-annotation-shell] [data-annotation-scan-group] p,
[data-annotation-shell] [data-annotation-scan-group] ul {
  margin: 0 0 var(--annotation-space-2);
}

[data-annotation-shell] [data-annotation-scan-group] ul {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-2);
  padding: 0;
  list-style: none;
}

/* One line per finding: number chip, the detail on one truncated line (its full text is the title), then the actions. */
[data-annotation-shell] [data-annotation-scan-finding] {
  display: flex;
  align-items: center;
  gap: var(--annotation-space-2);
  font-size: var(--annotation-font-size-caption);
}

/* Only the detail shrinks: the buttons keep their natural width and their text on one line. */
[data-annotation-shell] [data-annotation-scan-finding] button {
  flex: none;
}

[data-annotation-shell] [data-annotation-scan-finding] > :first-child {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

[data-annotation-shell] [data-annotation-scan-outline] {
  z-index: 2147483643;
  outline: 2px solid var(--annotation-color-accent);
  box-shadow: 0 0 0 4px var(--annotation-color-surface);
  pointer-events: none;
}

[data-annotation-shell] [data-annotation-scan-outline="error"] {
  outline-color: var(--annotation-color-danger);
}

[data-annotation-shell] [data-annotation-scan-outline="warning"] {
  outline-color: var(--annotation-color-warning);
}

[data-annotation-shell] [data-annotation-scan-outline][data-annotation-emphasis] {
  z-index: 2147483644;
  outline-width: 4px;
}

[data-annotation-shell] [data-annotation-scan-outline-number] {
  position: absolute;
  top: 0;
  left: 0;
  min-width: var(--annotation-space-4);
  padding: 0 var(--annotation-space-1);
  background: var(--annotation-color-accent);
  color: var(--annotation-color-surface);
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-bold);
  text-align: center;
}

[data-annotation-shell] [data-annotation-scan-outline="error"] [data-annotation-scan-outline-number] {
  background: var(--annotation-color-danger);
}

[data-annotation-shell] [data-annotation-scan-outline="warning"] [data-annotation-scan-outline-number] {
  background: var(--annotation-color-warning);
}

[data-annotation-shell] [data-annotation-scan-finding][data-annotation-scan-number]::before {
  content: attr(data-annotation-scan-number);
  flex: none;
  min-width: var(--annotation-space-4);
  padding: 0 var(--annotation-space-1);
  border-radius: var(--annotation-radius-sm);
  background: var(--annotation-color-hover);
  font-weight: var(--annotation-font-weight-bold);
  text-align: center;
}

[data-annotation-shell] [data-annotation-scan-page-level] {
  flex: none;
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
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

[data-annotation-shell] [data-annotation-list-footer] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--annotation-space-2);
  align-items: center;
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

/* The export buttons and Clear all are one row of the footer; Clear all sits at the far end. */
[data-annotation-shell] [data-annotation-list-footer] [data-annotation-export],
[data-annotation-shell] [data-annotation-list-footer] [data-annotation-export-actions] {
  display: contents;
}

[data-annotation-shell] [data-annotation-list-footer] > [data-annotation-clear] {
  margin-left: auto;
}

[data-annotation-shell] [data-annotation-list-footer] > [data-annotation-clear-prompt] {
  flex-basis: 100%;
}

[data-annotation-shell] [data-annotation-rows] {
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-2);
}

/* Number, one-line note and the icon actions share the first line; the muted element label and the status chip share the second. */
[data-annotation-shell] article[data-annotation-row] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  column-gap: var(--annotation-space-2);
  row-gap: var(--annotation-space-1);
  align-items: center;
  padding-bottom: var(--annotation-space-2);
  border-bottom: 1px solid var(--annotation-color-divider);
}

[data-annotation-shell] article[data-annotation-row] > [data-annotation-note] {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-annotation-shell] article[data-annotation-row] > [data-annotation-row-actions] {
  flex-wrap: nowrap;
}

[data-annotation-shell] article[data-annotation-row] > [data-annotation-hint] {
  grid-column: 2;
}

[data-annotation-shell] article[data-annotation-row] > [data-annotation-status] {
  grid-column: 3;
  justify-self: end;
}

[data-annotation-shell] article[data-annotation-row] > [data-annotation-locate-missing],
[data-annotation-shell] article[data-annotation-row]:has([data-annotation-delete-prompt]) > [data-annotation-row-actions] {
  grid-column: 1 / -1;
}

[data-annotation-shell] article[data-annotation-row] [data-annotation-row-actions]:has(> [data-annotation-delete-prompt]) {
  flex-wrap: wrap;
}

[data-annotation-shell] [data-annotation-row-actions] > [data-annotation-delete-prompt] {
  flex-basis: 100%;
}

[data-annotation-shell] [data-annotation-delete-prompt],
[data-annotation-shell] [data-annotation-clear-prompt] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--annotation-space-2);
  align-items: center;
}

[data-annotation-shell] [data-annotation-delete-prompt] > p,
[data-annotation-shell] [data-annotation-clear-prompt] > p {
  flex: 1 1 100%;
  margin: 0;
  color: var(--annotation-color-danger);
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
