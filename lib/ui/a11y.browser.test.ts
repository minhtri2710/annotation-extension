import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import popupHtml from '../../entrypoints/popup/index.html?raw';
import { captureShortcutHint } from '../capture/activation';
import { contrastRatio, parseColor, type Rgba } from '../lint/color';
import { PAGE_STYLES } from './page-styles';
import { buildOverlayShell, raiseOverlay } from './shell';
import { applyThemeMode, type ThemeMode } from './theme';
import { createToolbarControls } from './toolbar-controls';

const cleanups: (() => void)[] = [];

afterEach(async () => {
  await userEvent.cleanup();
  while (cleanups.length) cleanups.pop()!();
  document.body.style.removeProperty('background');
});

// Mirrors content.ts: WXT's shadow host with its `:host{all:initial !important}` reset, raised by raiseOverlay.
function mountOverlay(theme: ThemeMode) {
  const before = document.createElement('button');
  before.textContent = 'Page before';
  const host = document.createElement('div');
  const after = document.createElement('button');
  after.textContent = 'Page after';
  document.body.append(before, host, after);
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  reset.textContent = ':host{all:initial !important;}';
  const container = document.createElement('div');
  shadow.append(reset, container);
  const shell = buildOverlayShell(container);
  applyThemeMode(shell.root, theme);
  raiseOverlay(host);
  const buttons = ['Scan', 'View all', 'Annotate'].map((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    shell.toolbar.append(button);
    return button;
  });
  cleanups.push(() => {
    before.remove();
    host.remove();
    after.remove();
  });
  return { shadow, shell, buttons, before, after };
}

function color(value: string): Rgba {
  const parsed = parseColor(value);
  expect(parsed, value).toBeDefined();
  return parsed!;
}

function shadowColor(boxShadow: string): Rgba {
  return color(/rgba?\([^)]*\)|#[0-9a-f]+/i.exec(boxShadow)?.[0] ?? '');
}

describe.each<ThemeMode>(['light', 'dark'])('overlay contrast in the %s scheme', (theme) => {
  it('keeps hovered button text at 4.5:1 or more against its background', async () => {
    const { buttons } = mountOverlay(theme);
    const [scan] = buttons;
    const ratio = () => {
      const style = getComputedStyle(scan!);
      return contrastRatio(color(style.color), color(style.backgroundColor));
    };
    const raised = getComputedStyle(scan!.closest('[data-annotation-shell]')!).getPropertyValue('--annotation-color-surface-raised').trim();
    await userEvent.hover(scan!);
    expect(scan!.matches(':hover')).toBe(true);
    await vi.waitFor(() => expect(color(getComputedStyle(scan!).backgroundColor)).toEqual(color(raised)));
    expect(ratio()).toBeGreaterThanOrEqual(4.5);
  });

  it('styles mount buttons at rest instead of the native control, keeps primary and danger text at 4.5:1 or more at rest and on hover, and shows the badge unit', async () => {
    const { shell, buttons } = mountOverlay(theme);
    const [scan, , annotate] = buttons;
    annotate!.dataset.variant = 'primary';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.variant = 'danger';
    remove.textContent = 'Delete';
    shell.panel.append(remove);
    const badge = document.createElement('span');
    badge.dataset.annotationBadge = '';
    const unit = document.createElement('span');
    unit.dataset.annotationBadgeUnit = '';
    unit.textContent = ' annotations';
    badge.append('2', unit);
    shell.toolbar.append(badge);
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.dataset.annotationToolbarGrip = '';
    shell.toolbar.prepend(grip);

    const token = (name: string) => getComputedStyle(shell.root).getPropertyValue(`--annotation-${name}`).trim();
    const rest = getComputedStyle(scan!);
    expect(rest.appearance).toBe('none');
    expect(color(rest.backgroundColor)).toEqual(color(token('color-surface')));
    expect(rest.borderTopLeftRadius).toBe(token('radius-md'));
    expect(unit.getBoundingClientRect().width).toBeGreaterThan(1);
    expect(getComputedStyle(grip).cursor).toBe('grab');

    const accent = color(token('color-accent'));
    const danger = color(token('color-danger'));
    const look = (style: CSSStyleDeclaration) => [style.backgroundColor, style.borderTopColor].join(' ');
    for (const [button, fill, text] of [[annotate!, accent, undefined], [remove, undefined, danger]] as const) {
      let restLook = '';
      for (const hover of [false, true]) {
        if (hover) {
          await userEvent.hover(button);
          expect(button.matches(':hover')).toBe(true);
        }
        await vi.waitFor(() => {
          const style = getComputedStyle(button);
          if (fill) expect(color(style.backgroundColor), `${button.textContent} hover=${hover}`).toEqual(fill);
          if (text) expect(color(style.color), `${button.textContent} hover=${hover}`).toEqual(text);
          expect(contrastRatio(color(style.color), color(style.backgroundColor)), `${button.textContent} hover=${hover}`).toBeGreaterThanOrEqual(4.5);
          if (hover) expect(look(style), `${button.textContent} shows its hover`).not.toBe(restLook);
          else restLook = look(style);
        });
      }
    }
  });

  it.each(['#ffffff', '#000000'])('rings a focused pin at 3:1 or more on a %s page', async (page) => {
    const { shell, before } = mountOverlay(theme);
    document.body.style.background = page;
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'annotation-pin';
    pin.textContent = '1';
    shell.root.prepend(pin);
    before.focus();
    await userEvent.tab();
    expect((shell.root.getRootNode() as ShadowRoot).activeElement).toBe(pin);
    const style = getComputedStyle(pin);
    expect(style.outlineStyle).toBe('solid');
    const ring = color(style.outlineColor);
    const halo = shadowColor(style.boxShadow);
    expect(contrastRatio(ring, halo)).toBeGreaterThanOrEqual(3);
    expect(Math.max(contrastRatio(ring, color(page)), contrastRatio(halo, color(page)))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the pressed filter chip text at 4.5:1 or more against its background', () => {
    const { shell } = mountOverlay(theme);
    const filter = document.createElement('div');
    filter.dataset.annotationFilter = '';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = 'Errors (2)';
    chip.setAttribute('aria-pressed', 'true');
    filter.append(chip);
    shell.panel.append(filter);
    const style = getComputedStyle(chip);
    const raised = getComputedStyle(shell.panel).getPropertyValue('--annotation-color-surface-raised').trim();
    expect(color(style.backgroundColor)).toEqual(color(raised));
    const ratio = contrastRatio(color(style.color), color(style.backgroundColor));
    console.info(`pressed filter chip contrast (${theme}): ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('outlines a focused textarea at 3:1 or more against the panel surface', async () => {
    const { shell } = mountOverlay(theme);
    const field = document.createElement('textarea');
    shell.panel.append(field);
    field.focus();
    const style = getComputedStyle(field);
    expect(style.outlineStyle).toBe('solid');
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(color(style.outlineColor), color(getComputedStyle(shell.panel).backgroundColor))).toBeGreaterThanOrEqual(3);
  });
});

describe('live theme switch', () => {
  it('switches the panel text and surface colors when the theme changes on a mounted root', () => {
    const { shell } = mountOverlay('light');
    const read = () => {
      const style = getComputedStyle(shell.panel);
      return { text: color(style.color), surface: color(style.backgroundColor) };
    };
    const light = read();
    applyThemeMode(shell.root, 'dark');
    const dark = read();
    expect(dark.text).not.toEqual(light.text);
    expect(dark.surface).not.toEqual(light.surface);
    applyThemeMode(shell.root, 'light');
    expect(read()).toEqual(light);
  });
});

describe('toolbar keyboard model', () => {
  it('is one tab stop in the page order, with arrows, Home and End moving focus and wrapping', async () => {
    const { shadow, shell, buttons, before, after } = mountOverlay('light');
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: null, collapsed: false }), write: async () => undefined },
      onCollapsedChange: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const [scan, viewAll, annotate] = buttons;
    const grip = shell.toolbar.querySelector('[data-annotation-toolbar-grip]');
    const collapse = shell.toolbar.querySelector('[data-annotation-toolbar-collapse]');
    const focused = () => shadow.activeElement ?? document.activeElement;

    before.focus();
    await userEvent.tab();
    expect(shadow.activeElement).toBe(scan);
    await userEvent.tab();
    expect(shadow.activeElement).toBeNull();
    expect(document.activeElement).toBe(after);
    await userEvent.tab({ shift: true });
    expect(shadow.activeElement).toBe(scan);

    await userEvent.keyboard('{ArrowRight}');
    expect(focused()).toBe(viewAll);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(focused()).toBe(collapse);
    await userEvent.keyboard('{ArrowRight}');
    expect(focused()).toBe(grip);
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(collapse);
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe(grip);
    await userEvent.keyboard('{End}{ArrowLeft}');
    expect(focused()).toBe(annotate);

    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(before);
    await userEvent.tab();
    expect(shadow.activeElement).toBe(annotate);
  });
});

describe('popup heading', () => {
  it('has one h1 naming the extension and the same visible layout as without it', () => {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const headings = [...parsed.querySelectorAll('h1')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['Annotation Extension']);
    expect(parsed.querySelectorAll('h2, h3, h4, h5, h6')).toHaveLength(0);

    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    document.head.append(style);
    const render = (withHeading: boolean) => {
      const main = document.importNode(parsed.querySelector('main')!, true);
      if (!withHeading) main.querySelector('h1')!.remove();
      document.body.classList.add('annotation-page--popup');
      document.body.append(main);
      const rects = [...main.querySelectorAll('button, p')].map((element) => element.getBoundingClientRect().toJSON());
      const heading = main.querySelector('h1')?.getBoundingClientRect();
      main.remove();
      return { rects, heading };
    };
    cleanups.push(() => {
      style.remove();
      document.body.classList.remove('annotation-page--popup');
    });
    const withHeading = render(true);
    expect(withHeading.rects).toEqual(render(false).rects);
    expect(withHeading.heading!.width).toBeLessThanOrEqual(1);
    expect(withHeading.heading!.height).toBeLessThanOrEqual(1);
  });
});

describe('popup shortcut hint', () => {
  type HintState = { kind: 'set'; shortcut: string } | { kind: 'unset' } | { kind: 'failed' };

  // Mirrors popup/main.ts showShortcutHint: a read shortcut fills and shows the hint; a failed read leaves it untouched.
  function mountPopup(state: HintState, withHint = true) {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    document.head.append(style);
    const main = document.importNode(parsed.querySelector('main')!, true);
    document.body.classList.add('annotation-page--popup');
    document.body.append(main);
    cleanups.push(() => {
      main.remove();
      style.remove();
      document.body.classList.remove('annotation-page--popup');
    });
    const hint = main.querySelector<HTMLParagraphElement>('#shortcut-hint')!;
    const toggle = main.querySelector<HTMLButtonElement>('#toggle')!;
    if (!withHint) hint.remove();
    else if (state.kind !== 'failed') {
      hint.textContent = captureShortcutHint(state.kind === 'set' ? state.shortcut : '');
      hint.hidden = false;
      toggle.setAttribute('aria-describedby', 'shortcut-hint');
    }
    return { main, hint, toggle };
  }

  it.each<HintState>([
    { kind: 'set', shortcut: 'Ctrl+Shift+Y' },
    { kind: 'set', shortcut: 'MacCtrl+Shift+Alt+Y' },
    { kind: 'unset' },
  ])('fits the popup width without horizontal overflow: %o', (state) => {
    const { main, hint } = mountPopup(state);
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    expect(hint.scrollWidth).toBeLessThanOrEqual(hint.clientWidth);
    const hintRect = hint.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    expect(hintRect.width).toBeGreaterThan(0);
    expect(hintRect.left).toBeGreaterThanOrEqual(mainRect.left);
    expect(hintRect.right).toBeLessThanOrEqual(mainRect.right);
    if (state.kind === 'unset') {
      const lineHeight = Number.parseFloat(getComputedStyle(hint).lineHeight);
      expect(hintRect.height).toBeGreaterThan(lineHeight);
    }
  });

  it('takes no space when the read fails, leaving the other controls where they are without it', () => {
    const measure = (withHint: boolean) => {
      const { main, hint } = mountPopup({ kind: 'failed' }, withHint);
      const rects = [...main.querySelectorAll('button, p')]
        .filter((element) => element !== hint)
        .map((element) => element.getBoundingClientRect().toJSON());
      const hintRect = withHint ? hint.getBoundingClientRect() : undefined;
      cleanups.pop()!();
      return { rects, hintRect };
    };
    const failed = measure(true);
    expect(failed.hintRect!.height).toBe(0);
    expect(failed.rects).toEqual(measure(false).rects);
  });

  it.each<HintState>([{ kind: 'set', shortcut: 'Ctrl+Shift+Y' }, { kind: 'unset' }, { kind: 'failed' }])(
    'describes the toggle with one visible, non-empty hint only when the read succeeds: %o',
    (state) => {
      const { toggle } = mountPopup(state);
      if (state.kind === 'failed') {
        expect(toggle.hasAttribute('aria-describedby')).toBe(false);
        return;
      }
      const ids = toggle.getAttribute('aria-describedby')!.split(/\s+/);
      expect(ids).toHaveLength(1);
      const described = document.querySelectorAll(`#${ids[0]}`);
      expect(described).toHaveLength(1);
      const rect = described[0]!.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(described[0]!.textContent!.trim()).not.toBe('');
    },
  );
});
