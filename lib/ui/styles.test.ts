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

  it('keeps the extracted tokens and existing overlay invariants', () => {
    const rootRule = `[data-annotation-shell] {
${ANNOTATION_TOKENS}

  box-sizing: border-box;
  color: var(--annotation-color-text);
  font-family: var(--annotation-font-family);
  font-size: var(--annotation-font-size-body);
  line-height: var(--annotation-line-height);
}`;
    const darkRule = `[data-annotation-shell][data-theme="dark"] {
${ANNOTATION_DARK_TOKENS}
}`;
    const boxSizingRule = `[data-annotation-shell] *,
[data-annotation-shell] *::before,
[data-annotation-shell] *::after {
  box-sizing: inherit;
}`;
    const mountDisplayRule = `[data-annotation-shell] [data-annotation-mount="toolbar"],
[data-annotation-shell] [data-annotation-mount="panel"] {
  display: block;
}`;
    const toolbarRule = `[data-annotation-shell] [data-annotation-mount="toolbar"] {
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
}`;
    const panelRule = `[data-annotation-shell] [data-annotation-mount="panel"] {
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
}`;
    const formControlRule = `[data-annotation-shell] [data-annotation-mount] button,
[data-annotation-shell] [data-annotation-mount] input,
[data-annotation-shell] [data-annotation-mount] textarea,
[data-annotation-shell] [data-annotation-mount] select {
  max-width: 100%;
}`;

    expect(OVERLAY_STYLES).toContain(rootRule);
    expect(OVERLAY_STYLES).toContain(darkRule);
    expect(OVERLAY_STYLES).toContain(boxSizingRule);
    expect(OVERLAY_STYLES).toContain(mountDisplayRule);
    expect(OVERLAY_STYLES).toContain(toolbarRule);
    expect(OVERLAY_STYLES).toContain(panelRule);
    expect(OVERLAY_STYLES).toContain(formControlRule);

    expect(OVERLAY_STYLES).toContain(ANNOTATION_TOKENS);
    expect(OVERLAY_STYLES).toContain('[data-annotation-shell] {');
    expect(OVERLAY_STYLES).toContain('[data-annotation-shell][data-theme="dark"]');
    expect(OVERLAY_STYLES).toContain(ANNOTATION_DARK_TOKENS);
    expect(OVERLAY_STYLES).toContain('[data-annotation-mount="toolbar"]');
    expect(OVERLAY_STYLES).toContain('[data-annotation-mount="panel"]');
    expect(OVERLAY_STYLES).toContain('display: flex');
    expect(OVERLAY_STYLES).toContain('display: block');
    expect(OVERLAY_STYLES).toContain('border: 1px solid var(--annotation-color-border)');
    expect(OVERLAY_STYLES).toContain('border-radius: var(--annotation-radius-lg)');
    expect(OVERLAY_STYLES).toContain('background: var(--annotation-color-surface)');
    expect(OVERLAY_STYLES).toContain('box-shadow: 0 0.25rem 1rem rgba(23, 32, 51, 0.2)');
    expect(OVERLAY_STYLES).toContain('box-shadow: 0 0.75rem 2rem rgba(23, 32, 51, 0.24)');
    expect(OVERLAY_STYLES).toContain('[data-annotation-shell] [data-annotation-mount] select');

    const declarations = OVERLAY_STYLES.match(/--annotation-[a-z0-9-]+(?=:)/g) ?? [];
    expect(declarations).toHaveLength(31);
    expect(new Set(declarations)).toEqual(
      new Set([
        ...Object.keys({
          '--annotation-color-surface': true,
          '--annotation-color-surface-raised': true,
          '--annotation-color-text': true,
          '--annotation-color-text-muted': true,
          '--annotation-color-border': true,
          '--annotation-color-accent': true,
          '--annotation-color-danger': true,
          '--annotation-color-warning': true,
          '--annotation-space-1': true,
          '--annotation-space-2': true,
          '--annotation-space-3': true,
          '--annotation-space-4': true,
          '--annotation-radius-sm': true,
          '--annotation-radius-md': true,
          '--annotation-radius-lg': true,
          '--annotation-font-family': true,
          '--annotation-font-size-caption': true,
          '--annotation-font-size-body': true,
          '--annotation-font-size-title': true,
          '--annotation-font-weight-regular': true,
          '--annotation-font-weight-medium': true,
          '--annotation-font-weight-bold': true,
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

  it('hides an empty panel and scopes sibling spacing to the panel only', () => {
    expect(OVERLAY_STYLES).toContain('[data-annotation-shell] [data-annotation-mount="panel"]:empty {\n  display: none;\n}');
    expect(OVERLAY_STYLES).toContain(
      '[data-annotation-shell] [data-annotation-mount="panel"] > * + * {\n  margin-top: var(--annotation-space-3);\n}',
    );
    expect(OVERLAY_STYLES).not.toContain('[data-annotation-shell] [data-annotation-mount] > * + *');
  });

  it('defines marker, tooltip, and reduced-motion-safe locate pulse styles', () => {
    expect(OVERLAY_STYLES).toContain('.annotation-pin[data-annotation-status="resolved"]');
    expect(OVERLAY_STYLES).toContain('opacity: 0.55');
    expect(OVERLAY_STYLES).toContain('.annotation-pin');
    expect(OVERLAY_STYLES).toContain('.annotation-pin-tooltip');
    expect(OVERLAY_STYLES).toContain('pointer-events: none');
    expect(OVERLAY_STYLES).toContain('@keyframes locate-pulse');
    expect(OVERLAY_STYLES).toContain('.locate-pulse');
    expect(noPreferenceBlocks(OVERLAY_STYLES)).toContain('animation: locate-pulse 500ms');
    expect(noPreferenceBlocks(OVERLAY_STYLES)).toContain('animation: annotation-tooltip-fade-in 120ms');
  });

  it('uses type tokens instead of font-size and font-weight literals', () => {
    const rules = OVERLAY_STYLES.replace(ANNOTATION_TOKENS, '');
    const values = [...rules.matchAll(/font-(?:size|weight):\s*([^;]+);/g)].map((match) => match[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^var\(--annotation-font-(?:size|weight)-[a-z]+\)$/);
    expect(OVERLAY_STYLES).not.toContain('var(--annotation-font-size)');
    expect(ruleBody('[data-annotation-shell] .annotation-pin {')).toContain('font-weight: var(--annotation-font-weight-bold)');
    expect(ruleBody('[data-annotation-shell] .annotation-pin-tooltip {')).toContain(
      'font-size: var(--annotation-font-size-caption)',
    );
  });

  it('gives overlay buttons hover, focus-visible and active states from tokens', () => {
    const button = '[data-annotation-shell] [data-annotation-mount] button';
    expect(ruleBody(`${button}:hover {`)).toContain('border-color: var(--annotation-color-accent)');
    expect(ruleBody(`${button}:focus-visible {`)).toMatch(/outline: [^;]*solid var\(--annotation-color-accent\)/);
    expect(ruleBody(`${button}:active {`)).toContain('transform:');
    expect(ruleBody(`${button} {`)).toMatch(/transition: /);
  });

  it('gives pins hover, focus-visible and active states without !important', () => {
    const pin = '[data-annotation-shell] .annotation-pin';
    expect(ruleBody(`${pin}:hover {`)).toMatch(/outline: [^;]*var\(--annotation-color-accent\)/);
    expect(ruleBody(`${pin}:focus-visible {`)).toMatch(/outline: [^;]*solid var\(--annotation-color-text\)/);
    expect(ruleBody(`${pin}:active {`)).toContain('opacity:');
    expect(OVERLAY_STYLES).not.toContain('!important');
  });

  it('keeps transitions short and limited to paint-safe properties', () => {
    const transitions = [...OVERLAY_STYLES.matchAll(/transition: ([^;]+);/g)].map((match) => match[1] ?? '');
    expect(transitions.length).toBeGreaterThan(0);
    for (const transition of transitions.filter((value) => value !== 'none')) {
      for (const part of transition.split(',')) {
        const [property, duration] = part.trim().split(/\s+/);
        expect(['color', 'background', 'background-color', 'border-color', 'box-shadow', 'opacity', 'transform']).toContain(property);
        expect(Number.parseInt(duration ?? '', 10)).toBeLessThanOrEqual(150);
      }
    }
  });

  it('animates panel entry and the toolbar badge', () => {
    expect(OVERLAY_STYLES).toContain('@keyframes annotation-panel-enter');
    expect(ruleBody('[data-annotation-shell] [data-annotation-mount="panel"]:not(:empty) {')).toMatch(
      /animation: annotation-panel-enter (\d+)ms/,
    );
    const panelMs = /animation: annotation-panel-enter (\d+)ms/.exec(OVERLAY_STYLES)?.[1];
    expect(Number(panelMs)).toBeLessThanOrEqual(200);
    expect(OVERLAY_STYLES).toMatch(/@keyframes annotation-panel-enter \{\s*from \{ opacity: 0; transform: translateY\(/);
    expect(OVERLAY_STYLES).toContain('@keyframes annotation-badge-pop');
    expect(ruleBody('[data-annotation-shell] [data-annotation-badge] {', noPreferenceBlocks(OVERLAY_STYLES))).toContain(
      'animation: annotation-badge-pop',
    );
  });

  it('only enables motion inside the prefers-reduced-motion: no-preference opt-in', () => {
    expect(motionOutsideOptIn(OVERLAY_STYLES)).toEqual([]);
    expect(OVERLAY_STYLES).not.toContain('prefers-reduced-motion: reduce');
    const optIn = noPreferenceBlocks(OVERLAY_STYLES);
    for (const declaration of [
      'animation: annotation-panel-enter',
      'animation: annotation-badge-pop',
      'animation: annotation-tooltip-fade-in',
      'animation: locate-pulse',
      'transition: opacity',
      'transition: color',
      'transform: translateY(1px)',
    ]) {
      expect(optIn).toContain(declaration);
    }
  });

  it('styles the empty state as a muted, centered caption block', () => {
    const body = ruleBody('[data-annotation-shell] [data-annotation-empty-state] {');
    expect(body).toContain('color: var(--annotation-color-text-muted)');
    expect(body).toContain('text-align: center');
    expect(body).toMatch(/padding: var\(--annotation-space-/);
    expect(body).toContain('font-size: var(--annotation-font-size-caption)');
  });

  it('styles the scan highlight as a static, non-interactive accent outline under the toolbar', () => {
    const body = ruleBody('[data-annotation-shell] [data-annotation-scan-highlight] {');
    expect(body).toMatch(/(?:outline|border): 2px solid var\(--annotation-color-accent\)/);
    expect(body).toContain('pointer-events: none');
    const zIndex = Number(/z-index: (\d+)/.exec(body)?.[1]);
    expect(zIndex).toBeLessThan(2147483646);
    expect(zIndex).toBeGreaterThan(2147483000);
    expect(body).not.toMatch(/animation|transition|transform/);
    expect(noPreferenceBlocks(OVERLAY_STYLES)).not.toContain('data-annotation-scan');
  });

  it('styles scan groups, caption-size rows, the summary, and token-coloured severities', () => {
    expect(ruleBody('[data-annotation-shell] [data-annotation-scan-group] {')).toMatch(/var\(--annotation-/);
    expect(ruleBody('[data-annotation-shell] [data-annotation-scan-finding] {')).toContain(
      'font-size: var(--annotation-font-size-caption)',
    );
    expect(ruleBody('[data-annotation-shell] [data-annotation-scan-summary] {')).toMatch(/var\(--annotation-/);
    expect(ruleBody('[data-annotation-shell] [data-annotation-severity="error"] {')).toContain('color: var(--annotation-color-danger)');
    expect(ruleBody('[data-annotation-shell] [data-annotation-severity="warning"] {')).toContain('color: var(--annotation-color-warning)');
    expect(ruleBody('[data-annotation-shell] [data-annotation-severity="advisory"] {')).toContain(
      'color: var(--annotation-color-text-muted)',
    );
  });

  it('styles the toolbar grip as a touch-safe drag handle with a grabbing state', () => {
    const body = ruleBody('[data-annotation-shell] [data-annotation-toolbar-grip] {');
    expect(body).toContain('cursor: grab');
    expect(body).toContain('touch-action: none');
    expect(ruleBody('[data-annotation-shell] [data-annotation-toolbar-grip][data-dragging] {')).toContain('cursor: grabbing');
  });

  it('hides every collapsed toolbar child except the grip, collapse button and badge', () => {
    expect(
      ruleBody(
        '[data-annotation-shell] [data-annotation-mount="toolbar"][data-collapsed] > :not([data-annotation-toolbar-grip]):not([data-annotation-toolbar-collapse]):not([data-annotation-badge]) {',
      ),
    ).toContain('display: none');
  });

  it('styles the onboarding details with token colours and caption size and no motion', () => {
    const details = ruleBody('[data-annotation-shell] [data-annotation-onboarding] {');
    expect(details).toMatch(/var\(--annotation-color-/);
    expect(details).toContain('font-size: var(--annotation-font-size-caption)');
    expect(ruleBody('[data-annotation-shell] [data-annotation-onboarding] summary {')).toMatch(/var\(--annotation-/);
    expect(noPreferenceBlocks(OVERLAY_STYLES)).not.toMatch(/data-annotation-(?:onboarding|toolbar-grip|toolbar-collapse|collapsed)/);
  });
});

function ruleBody(selectorLine: string, css = OVERLAY_STYLES): string {
  const start = css.search(new RegExp(`\\n *${selectorLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  expect(start, selectorLine).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

const NO_PREFERENCE = '@media (prefers-reduced-motion: no-preference)';

function stripKeyframes(css: string): string {
  return css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
}

function motionOutsideOptIn(css: string): string[] {
  const text = stripKeyframes(css);
  const stack: string[] = [];
  const outside: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '{' && char !== '}' && char !== ';') continue;
    const chunk = text.slice(start, i).trim();
    if (char === '{') stack.push(chunk);
    else {
      if (/^(?:animation|animation-name|transition|transform)\s*:/.test(chunk) && !stack.includes(NO_PREFERENCE)) {
        outside.push(chunk);
      }
      if (char === '}') stack.pop();
    }
    start = i + 1;
  }
  return outside;
}

function noPreferenceBlocks(css: string): string {
  return css.split(NO_PREFERENCE).slice(1).join('\n');
}
