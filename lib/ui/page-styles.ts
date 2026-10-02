import { ANNOTATION_DARK_TOKENS, ANNOTATION_TOKENS } from './tokens';

export const PAGE_STYLES = `
:root {
${ANNOTATION_TOKENS}
}

@media (prefers-color-scheme: dark) {
  :root {
${ANNOTATION_DARK_TOKENS}
  }
}

body.annotation-page--popup,
body.annotation-page--options {
  min-width: 20rem;
  margin: 0;
  color: var(--annotation-color-text);
  background: var(--annotation-color-surface-raised);
  font-family: var(--annotation-font-family);
  font-size: var(--annotation-font-size-body);
  line-height: var(--annotation-line-height);
}

body.annotation-page--popup {
  width: 22rem;
}

body.annotation-page--options {
  min-width: 0;
}

.annotation-page__card {
  margin: var(--annotation-space-4);
  padding: var(--annotation-space-4);
  border: 1px solid var(--annotation-color-divider);
  border-radius: var(--annotation-radius-lg);
  background: var(--annotation-color-surface);
  box-shadow: 0 0.75rem 2rem color-mix(in srgb, var(--annotation-color-text) 14%, transparent);
}

body.annotation-page--popup .annotation-page__card {
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

/* The options card: one centred column, sections one gap apart, no shadow. */
body.annotation-page--options .annotation-page__card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--annotation-space-4);
  max-width: 560px;
  margin: 24px auto;
  padding: 24px;
  box-shadow: none;
}

body.annotation-page--options .annotation-page__card h1,
body.annotation-page--options .annotation-page__form,
body.annotation-page--options .annotation-page__list {
  margin: 0;
}

body.annotation-page--options .annotation-page__form p {
  margin: 0;
}

body.annotation-page--options .annotation-page__form p:empty,
body.annotation-page--options .annotation-page__list:empty {
  display: none;
}

body.annotation-page--options .annotation-page__form input,
body.annotation-page--options .annotation-page__form button {
  box-sizing: border-box;
  height: 2.25rem;
  padding-block: 0;
}

.annotation-page__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--annotation-space-3);
}

.annotation-page__footer .annotation-page__status {
  min-height: 0;
  margin: 0;
}

.annotation-page__card h1 {
  margin: 0 0 var(--annotation-space-4);
  font-size: var(--annotation-font-size-title);
  font-weight: var(--annotation-font-weight-bold);
  line-height: 1.2;
}

.annotation-page__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--annotation-space-2);
  margin-bottom: var(--annotation-space-3);
}

.annotation-page__header h1 {
  margin: 0;
}

.annotation-page__header .annotation-page__status {
  min-height: 0;
  margin: 0;
  font-size: var(--annotation-font-size-caption);
}

.annotation-page__actions {
  display: grid;
  gap: var(--annotation-space-2);
}

.annotation-page__group {
  margin-top: var(--annotation-space-4);
  padding-top: var(--annotation-space-3);
  border-top: 1px solid var(--annotation-color-divider);
}

.annotation-page__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--annotation-space-2);
  margin-bottom: var(--annotation-space-2);
}

.annotation-page__group h2 {
  margin: 0;
  color: var(--annotation-color-text-muted);
  font-size: var(--annotation-font-size-caption);
  font-weight: var(--annotation-font-weight-medium);
  line-height: 1.2;
}

.annotation-page__toggle,
.annotation-page__form {
  display: flex;
  align-items: center;
  gap: var(--annotation-space-2);
}

.annotation-page__form {
  align-items: end;
  flex-wrap: wrap;
  margin-top: var(--annotation-space-4);
}

.annotation-page__form label {
  flex-basis: 100%;
}

.annotation-page__form input {
  flex: 1 1 12rem;
}

/* Secondary is the base tier: a neutral fill and no border. */
.annotation-page__card button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--annotation-space-2);
  min-height: 2.25rem;
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 0;
  border-radius: var(--annotation-radius-md);
  color: var(--annotation-color-text);
  background: var(--annotation-color-surface-raised);
  font: inherit;
  cursor: pointer;
}

.annotation-page__card input[type='text'] {
  min-height: 2.25rem;
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-md);
  color: var(--annotation-color-text);
  background: var(--annotation-color-surface);
  font: inherit;
}

.annotation-page__card button:hover {
  background: var(--annotation-color-hover);
}

/* Primary: the one accent fill of the page. */
.annotation-page__card button[data-variant="primary"],
.annotation-page__card button[data-variant="primary"]:active {
  background: var(--annotation-color-accent);
  color: var(--annotation-color-on-accent);
  font-weight: var(--annotation-font-weight-medium);
}

.annotation-page__card button[data-variant="primary"]:hover {
  background: var(--annotation-color-accent);
  color: var(--annotation-color-on-accent);
  filter: brightness(0.92);
}

/* Ghost: transparent and muted until hovered. */
.annotation-page__card button[data-variant="quiet"] {
  min-height: 2rem;
  padding: var(--annotation-space-1) var(--annotation-space-2);
  background: transparent;
  color: var(--annotation-color-text-muted);
}

.annotation-page__card button[data-variant="quiet"]:hover {
  background: var(--annotation-color-hover);
  color: var(--annotation-color-text);
}

.annotation-page__card button[data-variant="danger"] {
  background: transparent;
  color: var(--annotation-color-danger);
}

.annotation-page__card button[data-variant="danger"]:hover {
  background: var(--annotation-color-hover);
}

/* Popup layout: Start annotating is the full-width primary, then the tab switch, then the exports on one row. */
body.annotation-page--popup .annotation-page__card > button[data-variant="primary"] {
  width: 100%;
}

body.annotation-page--popup .annotation-page__actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

body.annotation-page--popup #shortcut-hint {
  min-height: 0;
  margin: var(--annotation-space-1) 0 0;
  font-size: var(--annotation-font-size-caption);
  text-align: center;
}

body.annotation-page--popup #status {
  margin-top: var(--annotation-space-2);
  font-size: var(--annotation-font-size-caption);
}

body.annotation-page--popup .annotation-page__group {
  margin-top: var(--annotation-space-3);
}

.annotation-page__card button.annotation-page__switch {
  width: 100%;
  margin-top: var(--annotation-space-3);
  justify-content: space-between;
}

.annotation-page__switch-track {
  --switch-knob: 0.875rem;
  --switch-inset: 0.125rem;
  position: relative;
  flex: none;
  width: 2rem;
  height: calc(var(--switch-knob) + 2 * var(--switch-inset));
  border-radius: 999px;
  background: var(--annotation-color-border);
}

.annotation-page__switch-track::after {
  content: "";
  position: absolute;
  top: var(--switch-inset);
  left: var(--switch-inset);
  width: var(--switch-knob);
  height: var(--switch-knob);
  border-radius: 50%;
  background: var(--annotation-color-knob);
}

.annotation-page__switch[aria-checked="true"] .annotation-page__switch-track {
  background: var(--annotation-color-accent);
}

.annotation-page__switch[aria-checked="true"] .annotation-page__switch-track::after {
  left: calc(100% - var(--switch-knob) - var(--switch-inset));
}

.annotation-page__card button:disabled,
.annotation-page__card button:disabled:hover,
.annotation-page__card button:disabled:active {
  cursor: not-allowed;
  opacity: 0.55;
}

.annotation-page__card button:disabled:hover,
.annotation-page__card button:disabled:active {
  background: var(--annotation-color-surface-raised);
}

.annotation-page__card button[data-variant="primary"]:disabled:hover,
.annotation-page__card button[data-variant="primary"]:disabled:active {
  background: var(--annotation-color-accent);
  color: var(--annotation-color-on-accent);
  filter: none;
}

.annotation-page__card button:focus-visible,
.annotation-page__card input:focus-visible {
  outline: 0.15rem solid var(--annotation-color-accent);
  outline-offset: 0.1rem;
}

.annotation-page__list {
  display: grid;
  gap: var(--annotation-space-2);
  margin: var(--annotation-space-4) 0;
  padding: 0;
  list-style: none;
}

.annotation-page__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--annotation-space-2);
  padding: var(--annotation-space-1) 0;
  border-bottom: 1px solid var(--annotation-color-divider);
  overflow-wrap: anywhere;
}

.annotation-page__list button {
  flex: 0 0 auto;
  min-height: 2rem;
  padding: var(--annotation-space-1) var(--annotation-space-2);
}

.annotation-page__status {
  min-height: 1.4em;
  margin: var(--annotation-space-3) 0 0;
  color: var(--annotation-color-text-muted);
}

.annotation-page__toggle input {
  accent-color: var(--annotation-color-accent);
}

.annotation-page__status kbd {
  padding: 0 var(--annotation-space-1);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-sm);
  color: inherit;
}

@media (prefers-reduced-motion: no-preference) {
  .annotation-page__card button {
    transition: background 120ms ease-out, transform 120ms ease-out;
  }

  .annotation-page__card button:not(:disabled):active {
    transform: translateY(1px);
  }

  .annotation-page__switch-track {
    transition: background 120ms ease-out;
  }
}
`;
