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
  border: 1px solid var(--annotation-color-border);
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

.annotation-page__card h1 {
  margin: 0 0 var(--annotation-space-4);
  font-size: var(--annotation-font-size-title);
  font-weight: var(--annotation-font-weight-bold);
  line-height: 1.2;
}

.annotation-page__actions {
  display: grid;
  gap: var(--annotation-space-2);
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

.annotation-page__card button,
.annotation-page__card input[type='text'] {
  min-height: 2.25rem;
  padding: var(--annotation-space-2) var(--annotation-space-3);
  border: 1px solid var(--annotation-color-border);
  border-radius: var(--annotation-radius-md);
  color: var(--annotation-color-text);
  background: var(--annotation-color-surface);
  font: inherit;
}

.annotation-page__card button {
  cursor: pointer;
  transition: background 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
}

.annotation-page__card button:hover {
  border-color: var(--annotation-color-accent);
  background: var(--annotation-color-surface-raised);
}

.annotation-page__card button:active {
  transform: translateY(1px);
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
  padding: var(--annotation-space-2) 0;
  border-bottom: 1px solid var(--annotation-color-border);
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

@media (prefers-reduced-motion: reduce) {
  .annotation-page__card button {
    transition: none;
  }

  .annotation-page__card button:active {
    transform: none;
  }
}
`;
