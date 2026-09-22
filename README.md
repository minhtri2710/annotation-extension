# annotation-extension

A browser extension (Chrome + Firefox) for visual web annotation: mark up elements
on a page, capture element context and screenshots, and export the results for use
by an AI coding agent or a teammate.

Scope is **browser-only**. There is no server, no MCP, and no external backend or
account. All state lives in extension storage; results leave the extension only
through explicit user export (clipboard, Markdown, file).

The feature set is inspired by existing annotation tools (Vibe Annotations,
Impeccable's in-page tooling, MarkAgent). This is a **clean-room** implementation:
ideas and UX only, no third-party source is copied.

## Status

Bootstrapping. Toolchain: [WXT](https://wxt.dev) + TypeScript, Manifest V3, one
codebase targeting Chrome and Firefox.
