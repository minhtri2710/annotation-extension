import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import optionsHtml from '../../entrypoints/options/index.html?raw';
import popupHtml from '../../entrypoints/popup/index.html?raw';
import { mountOptionsPage } from '../options/options-page';
import { createAnnotationList } from '../annotation-list/annotation-list';
import type { Annotation } from '../annotation';
import { renderCaptureShortcutHint } from '../capture/activation';
import type { ElementContext } from '../capture/context';
import { contrastRatio, parseColor, type Rgba } from '../lint/color';
import { createNotePanel } from '../notes/note-panel';
import { setIconButton } from './icons';
import { ANNOTATION_DARK_TOKENS } from './tokens';
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
    const hover = getComputedStyle(scan!.closest('[data-annotation-shell]')!).getPropertyValue('--annotation-color-hover').trim();
    await userEvent.hover(scan!);
    expect(scan!.matches(':hover')).toBe(true);
    await vi.waitFor(() => expect(color(getComputedStyle(scan!).backgroundColor)).toEqual(color(hover)));
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
    expect(color(rest.backgroundColor).a).toBe(0);
    expect(rest.borderTopWidth).toBe('0px');
    expect(rest.borderTopLeftRadius).toBe(token('radius-md'));
    // The badge shows the number only; the unit stays in its text for assistive technology.
    expect(unit.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(badge.textContent).toBe('2 annotations');
    expect(getComputedStyle(grip).cursor).toBe('grab');

    const accent = color(token('color-accent'));
    const danger = color(token('color-danger'));
    const surface = color(getComputedStyle(shell.panel).backgroundColor);
    const look = (style: CSSStyleDeclaration) => [style.backgroundColor, style.borderTopColor, style.filter].join(' ');
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
          const background = color(style.backgroundColor).a === 0 ? surface : color(style.backgroundColor);
          expect(contrastRatio(color(style.color), background), `${button.textContent} hover=${hover}`).toBeGreaterThanOrEqual(4.5);
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
    expect(Number.parseFloat(style.boxShadow.match(/0px 0px 0px ([\d.]+)px/)?.[1] ?? '0')).toBeGreaterThan(
      Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth),
    );
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
    const surface = getComputedStyle(shell.panel).getPropertyValue('--annotation-color-surface').trim();
    expect(color(style.backgroundColor)).toEqual(color(surface));
    const ratio = contrastRatio(color(style.color), color(style.backgroundColor));
    console.info(`pressed filter chip contrast (${theme}): ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('outlines focused form fields at 3:1 or more against the panel surface', async () => {
    const { shell } = mountOverlay(theme);
    for (const field of [document.createElement('input'), document.createElement('textarea'), document.createElement('select')]) {
      shell.panel.append(field);
      field.focus();
      const style = getComputedStyle(field);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(color(style.outlineColor), color(getComputedStyle(shell.panel).backgroundColor))).toBeGreaterThanOrEqual(3);
      field.remove();
    }
  });

  it('keeps the count badge, quiet Capture and Attach and the secondary Add note at 4.5:1 or more at rest and on hover', async () => {
    const { shell } = mountOverlay(theme);
    const badge = document.createElement('span');
    badge.dataset.annotationBadge = '';
    badge.textContent = '2 annotations';
    shell.toolbar.append(badge);
    const actions = document.createElement('div');
    actions.dataset.annotationNoteActions = '';
    const capture = document.createElement('button');
    capture.type = 'button';
    capture.dataset.variant = 'quiet';
    capture.textContent = 'Capture screenshot';
    const attach = document.createElement('label');
    attach.dataset.annotationAttach = '';
    attach.textContent = 'Attach image';
    actions.append(capture, attach);
    const form = document.createElement('form');
    const addNote = document.createElement('button');
    addNote.type = 'button';
    addNote.dataset.variant = 'primary';
    addNote.textContent = 'Add note';
    form.append(addNote);
    shell.panel.append(actions, form);

    const surface = color(getComputedStyle(shell.panel).backgroundColor);
    const settle = (element: HTMLElement) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    const check = (name: string, element: HTMLElement) => {
      const style = getComputedStyle(element);
      const background = color(style.backgroundColor).a === 0 ? surface : color(style.backgroundColor);
      expect(contrastRatio(color(style.color), background), name).toBeGreaterThanOrEqual(4.5);
    };
    check('badge', badge);
    for (const [name, element] of [['quiet button', capture], ['quiet label', attach], ['Add note', addNote]] as const) {
      await userEvent.unhover(element);
      await settle(element);
      check(`${name} at rest`, element);
      await userEvent.hover(element);
      await vi.waitFor(() => expect(element.matches(':hover')).toBe(true));
      await settle(element);
      check(`${name} on hover`, element);
    }
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
      prefs: { read: async () => ({ position: null }), write: async () => undefined },
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    const [scan, viewAll, annotate] = buttons;
    const grip = shell.toolbar.querySelector('[data-annotation-toolbar-grip]');
    const hide = shell.toolbar.querySelector('[data-annotation-toolbar-hide]');
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
    expect(focused()).toBe(hide);
    await userEvent.keyboard('{ArrowRight}');
    expect(focused()).toBe(grip);
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(hide);
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
  it('has one visible h1 titling the popup, one All pages heading, and a header row with the page count', () => {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const headings = [...parsed.querySelectorAll('h1')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['Annotations']);
    expect([...parsed.querySelectorAll('h2, h3, h4, h5, h6')].map((heading) => heading.textContent)).toEqual(['All pages']);

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
    main.querySelector('#page-count')!.textContent = '3 annotations on this page.';
    const heading = main.querySelector('h1')!.getBoundingClientRect();
    const count = main.querySelector('#page-count')!.getBoundingClientRect();
    expect(heading.width).toBeGreaterThan(1);
    expect(heading.height).toBeGreaterThan(1);
    expect(Math.abs((heading.top + heading.height / 2) - (count.top + count.height / 2))).toBeLessThanOrEqual(8);
    expect(heading.right).toBeLessThanOrEqual(count.left);
  });
});

describe.each(['light', 'dark'] as const)('popup primary in the %s token scheme', (scheme) => {
  it('uses the accent fill and keeps toggle text at 4.5:1 at rest and hover, including disabled state', async () => {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const pageStyle = document.createElement('style');
    pageStyle.textContent = PAGE_STYLES;
    const darkTokens = document.createElement('style');
    if (scheme === 'dark') darkTokens.textContent = `:root {\n${ANNOTATION_DARK_TOKENS}\n}`;
    document.head.append(pageStyle, darkTokens);
    const main = document.importNode(parsed.querySelector('main')!, true);
    document.body.classList.add('annotation-page--popup');
    document.body.append(main);
    cleanups.push(() => {
      main.remove();
      pageStyle.remove();
      darkTokens.remove();
      document.body.classList.remove('annotation-page--popup');
    });
    const toggle = main.querySelector<HTMLButtonElement>('#toggle')!;
    toggle.disabled = false;
    const settle = () => Promise.allSettled(toggle.getAnimations().map((animation) => animation.finished));
    const accent = color(getComputedStyle(document.documentElement).getPropertyValue('--annotation-color-accent'));
    const checkContrast = () => {
      const style = getComputedStyle(toggle);
      expect(color(style.backgroundColor)).toEqual(accent);
      expect(contrastRatio(color(style.color), color(style.backgroundColor))).toBeGreaterThanOrEqual(4.5);
    };
    await userEvent.unhover(toggle);
    await vi.waitFor(() => expect(toggle.matches(':hover')).toBe(false));
    await settle();
    checkContrast();
    await userEvent.hover(toggle);
    await vi.waitFor(() => expect(toggle.matches(':hover')).toBe(true));
    await settle();
    checkContrast();
    toggle.disabled = true;
    await settle();
    expect(Number.parseFloat(getComputedStyle(toggle).opacity)).toBeLessThan(1);
    expect(getComputedStyle(toggle).cursor).toBe('not-allowed');
    await userEvent.unhover(toggle);
    await vi.waitFor(() => expect(toggle.matches(':hover')).toBe(false));
    await settle();
    const disabledBackground = getComputedStyle(toggle).backgroundColor;
    const disabledBorder = getComputedStyle(toggle).borderTopColor;
    await userEvent.hover(toggle);
    await vi.waitFor(() => expect(toggle.matches(':hover')).toBe(true));
    await settle();
    expect(getComputedStyle(toggle).backgroundColor).toBe(disabledBackground);
    expect(getComputedStyle(toggle).borderTopColor).toBe(disabledBorder);
    const hint = main.querySelector<HTMLParagraphElement>('#shortcut-hint')!;
    renderCaptureShortcutHint(hint, 'Alt+Q');
    expect(getComputedStyle(hint.querySelector('kbd')!).borderTopWidth).toBe('1px');
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
      renderCaptureShortcutHint(hint, state.kind === 'set' ? state.shortcut : '');
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

describe('popup layout', () => {
  // Loads the real popup markup; only the runtime-filled page count and shortcut hint are set here.
  function mountLayout(scheme: 'light' | 'dark' = 'light') {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    const darkTokens = document.createElement('style');
    if (scheme === 'dark') darkTokens.textContent = `:root {\n${ANNOTATION_DARK_TOKENS}\n}`;
    document.head.append(style, darkTokens);
    const main = document.importNode(parsed.querySelector('main')!, true);
    document.body.classList.add('annotation-page--popup');
    document.body.append(main);
    cleanups.push(() => {
      main.remove();
      style.remove();
      darkTokens.remove();
      document.body.classList.remove('annotation-page--popup');
    });
    const byId = <T extends HTMLElement>(id: string) => main.querySelector<T>(`#${id}`)!;
    byId('page-count').textContent = '2 annotations on this page.';
    renderCaptureShortcutHint(byId<HTMLParagraphElement>('shortcut-hint'), 'Alt+Q');
    return { main, byId };
  }

  it('has a fixed width between 320 and 400 px that the viewport does not change', async () => {
    const { main } = mountLayout();
    const width = () => document.body.getBoundingClientRect().width;
    expect(width()).toBeGreaterThanOrEqual(320);
    expect(width()).toBeLessThanOrEqual(400);
    expect(main.getBoundingClientRect().width).toBe(width());
    const fixed = width();
    await page.viewport(900, 600);
    expect(width()).toBe(fixed);
    await page.viewport(1280, 720);
  });

  it('puts the page count in the header, then Start annotating at full width, a small muted shortcut hint and the toolbar switch', () => {
    const { main, byId } = mountLayout();
    const count = byId('page-count').getBoundingClientRect();
    const toggle = byId('toggle').getBoundingClientRect();
    const toolbar = byId('toolbar-toggle').getBoundingClientRect();
    const hint = byId('shortcut-hint');
    const card = main.getBoundingClientRect();
    expect(count.bottom).toBeLessThanOrEqual(toggle.top);
    expect(toggle.width).toBeGreaterThanOrEqual(card.width - 2 * 16 - 1);
    expect(toolbar.width).toBeGreaterThanOrEqual(card.width - 2 * 16 - 1);
    expect(hint.getBoundingClientRect().top).toBeGreaterThanOrEqual(toggle.bottom);
    expect(toolbar.top).toBeGreaterThanOrEqual(hint.getBoundingClientRect().bottom);
    const style = getComputedStyle(hint);
    const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--annotation-${name}`).trim();
    expect(style.fontSize).toBe(token('font-size-caption'));
    expect(color(style.color)).toEqual(color(token('color-text-muted')));
  });

  it('shows the exports as JSON and Markdown on one row with their full names, and Import as a quiet button in the All pages heading row', () => {
    const { byId } = mountLayout();
    const json = byId('export');
    const markdown = byId('export-markdown');
    const upload = byId('import');
    expect([json, markdown, upload].map((button) => button.textContent)).toEqual(['JSON', 'Markdown', 'Import']);
    expect([json, markdown, upload].map((button) => button.getAttribute('aria-label'))).toEqual(['Export JSON', 'Export Markdown', 'Import JSON']);
    const [jsonRect, markdownRect, importRect] = [json, markdown, upload].map((button) => button.getBoundingClientRect());
    expect(Math.abs(jsonRect!.top - markdownRect!.top)).toBeLessThanOrEqual(1);
    expect(jsonRect!.right).toBeLessThanOrEqual(markdownRect!.left);
    expect(importRect!.bottom).toBeLessThanOrEqual(jsonRect!.top);
    for (const button of [json, markdown, upload]) expect(getComputedStyle(button).borderTopWidth).toBe('0px');
    expect(color(getComputedStyle(json).backgroundColor).a).toBe(1);
    expect(color(getComputedStyle(upload).backgroundColor).a).toBe(0);
  });

  it.each(['light', 'dark'] as const)('keeps every popup button look and the shortcut hint at 4.5:1 or more in the %s scheme', async (scheme) => {
    const { main, byId } = mountLayout(scheme);
    const settle = (button: HTMLElement) => Promise.allSettled(button.getAnimations().map((animation) => animation.finished));
    for (const id of ['toolbar-toggle', 'export', 'export-markdown', 'import']) {
      const button = byId<HTMLButtonElement>(id);
      button.disabled = false;
      for (const hover of [false, true]) {
        if (hover) await userEvent.hover(button);
        else await userEvent.unhover(button);
        await vi.waitFor(() => expect(button.matches(':hover')).toBe(hover));
        await settle(button);
        const style = getComputedStyle(button);
        const background = color(style.backgroundColor).a === 0 ? color(getComputedStyle(main).backgroundColor) : color(style.backgroundColor);
        expect(contrastRatio(color(style.color), background), `${id} hover=${hover}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    const surface = color(getComputedStyle(main).backgroundColor);
    expect(contrastRatio(color(getComputedStyle(byId('shortcut-hint')).color), surface)).toBeGreaterThanOrEqual(4.5);
  });
});

// Quiet light and dark palette, read from computed styles on the real surfaces.
describe.each<ThemeMode>(['light', 'dark'])('button tiers and palette on the real surfaces in the %s scheme', (theme) => {
  const pageUrl = 'https://example.com/article';
  const context: ElementContext = {
    selector: '#target', tagName: 'BUTTON', id: 'target', classList: [], text: 'Target',
    boundingBox: { x: 0, y: 0, width: 10, height: 10 }, url: pageUrl,
    viewport: { width: 1280, height: 720 }, sourcePath: null,
  };
  const stored = (id: string, selector = '#target'): Annotation => ({
    id, pageUrl, note: `Note ${id}`, selector, elementContext: context,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', status: 'open',
  });
  const CONTROLS = 'button, label[data-annotation-attach], input:not([type="file"]):not([type="hidden"]), select';

  function mountPopupPage(): { root: HTMLElement; byId: <T extends HTMLElement>(id: string) => T; surface: Rgba } {
    const parsed = new DOMParser().parseFromString(popupHtml, 'text/html');
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    const darkTokens = document.createElement('style');
    if (theme === 'dark') darkTokens.textContent = `:root {\n${ANNOTATION_DARK_TOKENS}\n}`;
    document.head.append(style, darkTokens);
    const main = document.importNode(parsed.querySelector('main')!, true);
    document.body.classList.add('annotation-page--popup');
    document.body.append(main);
    cleanups.push(() => {
      main.remove();
      style.remove();
      darkTokens.remove();
      document.body.classList.remove('annotation-page--popup');
    });
    const byId = <T extends HTMLElement>(id: string) => main.querySelector<T>(`#${id}`)!;
    byId('page-count').textContent = '2 annotations on this page.';
    renderCaptureShortcutHint(byId<HTMLParagraphElement>('shortcut-hint'), 'Alt+Q');
    for (const id of ['toggle', 'toolbar-toggle']) byId<HTMLButtonElement>(id).disabled = false;
    return { root: main, byId, surface: color(getComputedStyle(main).getPropertyValue('--annotation-color-surface').trim()) };
  }

  async function mountToolbarSurface() {
    const mounted = mountOverlay(theme);
    const { shell, buttons } = mounted;
    for (const button of buttons) button.remove();
    const scan = document.createElement('button');
    scan.type = 'button';
    setIconButton(scan, 'scan', 'Scan');
    const list = document.createElement('button');
    list.type = 'button';
    setIconButton(list, 'list', 'View all');
    const annotate = document.createElement('button');
    annotate.type = 'button';
    annotate.dataset.variant = 'primary';
    annotate.textContent = 'Annotate';
    const badge = document.createElement('span');
    badge.dataset.annotationBadge = '';
    const unit = document.createElement('span');
    unit.dataset.annotationBadgeUnit = '';
    unit.textContent = ' annotations';
    badge.append('2', unit);
    shell.toolbar.append(scan, list, annotate, badge);
    const controls = createToolbarControls({
      toolbar: shell.toolbar,
      win: window,
      prefs: { read: async () => ({ position: null }), write: async () => undefined },
      onHide: () => undefined,
      onPositionChange: () => undefined,
    });
    cleanups.push(() => controls.destroy());
    await controls.ready;
    return { ...mounted, root: shell.toolbar as HTMLElement, surface: color(getComputedStyle(shell.toolbar).backgroundColor) };
  }

  async function mountNotesSurface(annotations: Annotation[]) {
    const mounted = mountOverlay(theme);
    const { shell } = mounted;
    for (const button of mounted.buttons) button.remove();
    const notePanel = createNotePanel(shell.panel, {
      listAnnotations: async () => annotations,
      sendAnnotationWrite: vi.fn(), captureScreenshot: vi.fn(), readBlob: vi.fn(), addAttachment: vi.fn(), deleteAttachment: vi.fn(),
      applyCssEdits: vi.fn(), revertCssEdits: vi.fn(), revertAllCssEdits: vi.fn(),
    });
    shell.root.append(notePanel.live);
    await notePanel.render(context);
    return { ...mounted, notePanel, root: shell.panel as HTMLElement, surface: color(getComputedStyle(shell.panel).backgroundColor) };
  }

  async function mountListSurface() {
    const mounted = mountOverlay(theme);
    const { shell } = mounted;
    for (const button of mounted.buttons) button.remove();
    const list = createAnnotationList(shell.panel, pageUrl, {
      listAnnotations: async () => [stored('a1'), { ...stored('a2'), status: 'resolved' }],
      sendAnnotationWrite: vi.fn(), readBlob: vi.fn(),
      readOnboardingOpen: async () => false, writeOnboardingOpen: async () => undefined,
      readCaptureShortcut: async () => 'Alt+Q',
    });
    shell.root.append(list.live);
    cleanups.push(() => list.clear());
    await list.render();
    return { ...mounted, list, root: shell.panel as HTMLElement, surface: color(getComputedStyle(shell.panel).backgroundColor) };
  }

  const token = (root: Element, name: string) => color(getComputedStyle(root).getPropertyValue(`--annotation-${name}`).trim());
  const controlsOf = (root: Element) => [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter((element) => element.getBoundingClientRect().width > 0);
  const tierOf = (element: HTMLElement) => {
    if (element.getAttribute('role') === 'switch' || element.closest('[data-annotation-filter]')) return 'switch';
    if (element.dataset.variant === 'primary') return 'primary';
    if (element.dataset.variant === 'danger') return element.closest('[role="group"]') ? 'confirm' : 'danger';
    if (element.dataset.variant === 'quiet' || element.matches('label[data-annotation-attach]')) return 'ghost';
    return 'secondary';
  };
  const backgroundBehind = (element: Element, surface: Rgba): Rgba => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const background = color(getComputedStyle(node).backgroundColor);
      if (background.a === 1) return background;
    }
    return surface;
  };
  const textContrast = (element: HTMLElement, surface: Rgba) => {
    const own = color(getComputedStyle(element).backgroundColor);
    const background = own.a === 1 ? own : backgroundBehind(element, surface);
    return contrastRatio(color(getComputedStyle(element).color), background);
  };
  const hasInk = (element: HTMLElement) => (element.textContent ?? '').trim() !== '' || element.querySelector('svg') !== null;

  async function surfaces() {
    const popup = mountPopupPage();
    const toolbar = await mountToolbarSurface();
    const notes = await mountNotesSurface([stored('n1')]);
    const noNotes = await mountNotesSurface([]);
    const list = await mountListSurface();
    return { popup, toolbar, notes, noNotes, list };
  }

  it('fills exactly one control with the accent on the popup, the toolbar and a Notes panel with one note and its form folded', async () => {
    const { popup, toolbar, notes, noNotes } = await surfaces();
    const accentCount = (root: Element) => controlsOf(root).filter((element) => {
      const background = color(getComputedStyle(element).backgroundColor);
      return JSON.stringify(background) === JSON.stringify(token(root, 'color-accent'));
    });
    expect(accentCount(popup.root).map((element) => element.id)).toEqual(['toggle']);
    expect(accentCount(toolbar.root).map((element) => element.textContent)).toEqual(['Annotate']);
    expect(accentCount(notes.root).map((element) => element.textContent)).toEqual(['Save']);
    expect(notes.root.querySelector<HTMLElement>('[data-annotation-add-another]')!.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(noNotes.root.querySelectorAll('[data-annotation-edit]')).toHaveLength(0);
    expect(accentCount(noNotes.root).map((element) => element.textContent)).toEqual(['Add note']);
  });

  it('keeps exactly one accent control when a Notes panel is rendered again after it was closed', async () => {
    const { notes } = await surfaces();
    notes.shell.panel.replaceChildren();
    await notes.notePanel.render(context);
    const accent = token(notes.root, 'color-accent');
    const filled = controlsOf(notes.shell.panel).filter((element) => JSON.stringify(color(getComputedStyle(element).backgroundColor)) === JSON.stringify(accent));
    expect(filled.map((element) => element.textContent)).toEqual(['Save']);
    expect(notes.shell.panel.querySelectorAll('[data-annotation-add-another]')).toHaveLength(1);
  });

  it('draws secondary and ghost buttons with no border and danger as red text on a transparent base, except a confirm button', async () => {
    const { popup, toolbar, notes, list } = await surfaces();
    notes.shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!.click();
    list.root.querySelector<HTMLButtonElement>('[data-annotation-clear]')!.click();
    const seen = new Set<string>();
    for (const root of [popup.root, toolbar.root, notes.root, list.root]) {
      for (const element of controlsOf(root)) {
        const tier = tierOf(element);
        if (tier === 'switch') continue;
        seen.add(tier);
        const style = getComputedStyle(element);
        if (tier !== 'primary' && tier !== 'confirm') {
          expect([style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], `${tier} ${element.outerHTML}`).toEqual(['0px', '0px', '0px', '0px']);
        }
        if (tier === 'danger') {
          expect(color(style.backgroundColor).a, element.outerHTML).toBe(0);
          expect(color(style.color)).toEqual(token(root, 'color-danger'));
        }
        if (tier === 'confirm') expect(color(style.backgroundColor)).toEqual(token(root, 'color-danger'));
        if (tier === 'ghost') expect(color(style.backgroundColor).a, element.outerHTML).toBe(0);
      }
    }
    expect([...seen].sort()).toEqual(['confirm', 'danger', 'ghost', 'primary', 'secondary']);
  });

  it('keeps primary, secondary, ghost, danger, confirm and muted text at 4.5:1 or more at rest', async () => {
    const { popup, toolbar, notes, list } = await surfaces();
    notes.shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!.click();
    for (const { root, surface } of [popup, toolbar, notes, list]) {
      for (const element of controlsOf(root)) {
        if (!hasInk(element) || (element as HTMLButtonElement).disabled) continue;
        expect(textContrast(element, surface), `${tierOf(element)} ${element.outerHTML}`).toBeGreaterThanOrEqual(4.5);
      }
      const muted = root.querySelectorAll<HTMLElement>('[data-annotation-hint], [data-annotation-attach-name], [data-annotation-unsaved], [data-annotation-list-count], .annotation-page__status, .annotation-page__group h2, [data-annotation-badge]');
      for (const element of muted) {
        if (element.getBoundingClientRect().width === 0) continue;
        expect(textContrast(element, surface), element.outerHTML).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps one control of each tier at 4.5:1 or more on hover and changes its look', async () => {
    const release = () => { while (cleanups.length) cleanups.pop()!(); };
    const seen = new Set<string>();
    const mounters: (() => Promise<{ root: HTMLElement; surface: Rgba }>)[] = [
      async () => mountPopupPage(),
      async () => {
        const notes = await mountNotesSurface([stored('n1')]);
        notes.shell.panel.querySelector<HTMLButtonElement>('[data-annotation-delete]')!.click();
        return notes;
      },
      async () => {
        const list = await mountListSurface();
        list.root.querySelector<HTMLButtonElement>('[data-annotation-clear]')!.click();
        return list;
      },
    ];
    for (const mount of mounters) {
      const { root, surface } = await mount();
      const picked = new Map<string, HTMLElement>();
      for (const element of controlsOf(root)) {
        if (!hasInk(element) || (element as HTMLButtonElement).disabled) continue;
        const tier = tierOf(element);
        if (tier !== 'switch' && !picked.has(tier)) picked.set(tier, element);
      }
      for (const [tier, element] of picked) {
        seen.add(tier);
        const look = () => {
          const style = getComputedStyle(element);
          return [style.backgroundColor, style.color, style.filter].join(' ');
        };
        await userEvent.unhover(element);
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
        const rest = look();
        await userEvent.hover(element);
        await vi.waitFor(() => expect(element.matches(':hover')).toBe(true));
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
        expect(look(), `${tier} shows its hover`).not.toBe(rest);
        expect(textContrast(element, surface), `${tier} on hover`).toBeGreaterThanOrEqual(4.5);
      }
      release();
    }
    expect([...seen].sort()).toEqual(['confirm', 'danger', 'ghost', 'primary', 'secondary']);
  });

  it('rings a control reached by keyboard with a 2px accent outline', async () => {
    const notes = await mountNotesSurface([stored('n1')]);
    const close = notes.shell.panel.querySelector<HTMLButtonElement>('[data-annotation-close]')!;
    notes.before.focus();
    for (let step = 0; step < 12 && notes.shadow.activeElement !== close; step += 1) await userEvent.tab();
    expect(notes.shadow.activeElement).toBe(close);
    const style = getComputedStyle(close);
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(color(style.outlineColor)).toEqual(token(notes.root, 'color-accent'));
  });

  it('shows the pressed filter segment in the accent and the others muted, and moves the press with the choice', async () => {
    const { list } = await surfaces();
    const segments = () => [...list.root.querySelectorAll<HTMLButtonElement>('[data-annotation-filter] button')];
    const pressed = () => segments().map((segment) => segment.getAttribute('aria-pressed'));
    const colors = async () => {
      await Promise.allSettled(segments().flatMap((segment) => segment.getAnimations().map((animation) => animation.finished)));
      return segments().map((segment) => color(getComputedStyle(segment).color));
    };
    const accent = token(list.root, 'color-accent');
    const muted = token(list.root, 'color-text-muted');
    expect(pressed()).toEqual(['true', 'false', 'false']);
    expect(await colors()).toEqual([accent, muted, muted]);
    expect(getComputedStyle(segments()[0]!).boxShadow).not.toBe('none');
    segments()[1]!.click();
    await vi.waitFor(() => expect(pressed()).toEqual(['false', 'true', 'false']));
    expect(await colors()).toEqual([muted, accent, muted]);
    for (const segment of segments()) expect(textContrast(segment, list.surface), segment.textContent ?? '').toBeGreaterThanOrEqual(4.5);
  });

  it('draws the switch off in the neutral track and on in the accent track, both readable against the card', async () => {
    const { popup } = await surfaces();
    const toggle = popup.byId<HTMLButtonElement>('toolbar-toggle');
    const track = toggle.querySelector<HTMLElement>('.annotation-page__switch-track')!;
    const card = color(getComputedStyle(popup.root).backgroundColor);
    expect(toggle.getAttribute('role')).toBe('switch');
    for (const [checked, name] of [['false', 'color-border'], ['true', 'color-accent']] as const) {
      toggle.setAttribute('aria-checked', checked);
      await Promise.allSettled(track.getAnimations().map((animation) => animation.finished));
      const background = color(getComputedStyle(track).backgroundColor);
      expect(background, checked).toEqual(token(popup.root, name));
      expect(contrastRatio(background, card), checked).toBeGreaterThanOrEqual(3);
    }
  });

  it('paints the switch knob white on and off in both schemes, over a track that keeps 3:1 against the card', async () => {
    const { popup } = await surfaces();
    const toggle = popup.byId<HTMLButtonElement>('toolbar-toggle');
    const track = toggle.querySelector<HTMLElement>('.annotation-page__switch-track')!;
    const card = color(getComputedStyle(popup.root).backgroundColor);
    for (const checked of ['false', 'true']) {
      toggle.setAttribute('aria-checked', checked);
      await Promise.allSettled(track.getAnimations().map((animation) => animation.finished));
      expect(getComputedStyle(track, '::after').backgroundColor, checked).toBe('rgb(255, 255, 255)');
      expect(contrastRatio(color(getComputedStyle(track).backgroundColor), card), checked).toBeGreaterThanOrEqual(3);
    }
  });

  it('insets the switch knob evenly inside its track off and on, and keeps it fully inside', async () => {
    const { popup } = await surfaces();
    const toggle = popup.byId<HTMLButtonElement>('toolbar-toggle');
    const track = toggle.querySelector<HTMLElement>('.annotation-page__switch-track')!;
    const insets = async (checked: string) => {
      toggle.setAttribute('aria-checked', checked);
      await Promise.allSettled(track.getAnimations({ subtree: true }).map((animation) => animation.finished));
      const box = track.getBoundingClientRect();
      const knob = getComputedStyle(track, '::after');
      const left = Number.parseFloat(knob.left);
      const top = Number.parseFloat(knob.top);
      const width = Number.parseFloat(knob.width);
      const height = Number.parseFloat(knob.height);
      return { left, top, right: box.width - left - width, bottom: box.height - top - height };
    };
    const off = await insets('false');
    const on = await insets('true');

    expect(Math.abs(off.left - off.top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.right - off.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.top - off.top)).toBeLessThanOrEqual(0.5);
    for (const inset of [...Object.values(off), ...Object.values(on)]) expect(inset).toBeGreaterThanOrEqual(0);
  });

  it('keeps the Notes footer and the popup export row each on one row', async () => {
    const { popup, notes } = await surfaces();
    const tops = (elements: Element[]) => elements.map((element) => element.getBoundingClientRect().top);
    const footer = [...notes.root.querySelectorAll('[data-annotation-note-actions] > button')];
    expect(footer.map((button) => button.textContent)).toEqual(['Delete', 'Resolve', 'Save']);
    expect(Math.max(...tops(footer)) - Math.min(...tops(footer))).toBeLessThanOrEqual(1);
    const exports = [popup.byId('export'), popup.byId('export-markdown')];
    expect(Math.max(...tops(exports)) - Math.min(...tops(exports))).toBeLessThanOrEqual(1);
  });
});

describe.each<ThemeMode>(['light', 'dark'])('options page layout in the %s scheme', (theme) => {
  async function mountOptions() {
    const parsed = new DOMParser().parseFromString(optionsHtml, 'text/html');
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    const darkTokens = document.createElement('style');
    if (theme === 'dark') darkTokens.textContent = `:root {\n${ANNOTATION_DARK_TOKENS}\n}`;
    document.head.append(style, darkTokens);
    const main = document.importNode(parsed.querySelector('main')!, true);
    document.body.classList.add('annotation-page--options');
    document.body.append(main);
    cleanups.push(() => {
      main.remove();
      style.remove();
      darkTokens.remove();
      document.body.classList.remove('annotation-page--options');
    });
    const byId = <T extends HTMLElement>(id: string) => main.querySelector<T>(`#${id}`)!;
    await mountOptionsPage(
      {
        enabled: byId<HTMLInputElement>('enabled'),
        form: byId<HTMLFormElement>('allowlist-form'),
        entry: byId<HTMLInputElement>('allowlist-entry'),
        entryError: byId('allowlist-error'),
        allowlist: byId<HTMLUListElement>('allowlist'),
        save: byId<HTMLButtonElement>('save'),
        status: byId('status'),
      },
      { read: async () => ({ enabled: true, allowlist: ['example.com', 'docs.example.org'] }), write: async () => undefined },
    );
    return { main, byId };
  }

  it('centres a 560 px card with 24 px padding, a divider border and no shadow, and spaces its sections 16 px apart with no band under the last', async () => {
    await page.viewport(1280, 720);
    const { main } = await mountOptions();
    const style = getComputedStyle(main);
    const rect = main.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(560);
    expect(rect.width).toBeGreaterThanOrEqual(520);
    expect(Math.abs(rect.left - (document.documentElement.clientWidth - rect.right))).toBeLessThanOrEqual(1);
    expect(style.paddingTop).toBe('24px');
    expect(style.paddingLeft).toBe('24px');
    expect(style.boxShadow).toBe('none');
    expect(style.borderTopWidth).toBe('1px');

    const sections = [...main.children].filter((element) => element.getBoundingClientRect().height > 0);
    expect(sections.map((element) => element.tagName.toLowerCase())).toEqual(['h1', 'label', 'form', 'ul', 'div']);
    for (let index = 1; index < sections.length; index += 1) {
      const gap = sections[index]!.getBoundingClientRect().top - sections[index - 1]!.getBoundingClientRect().bottom;
      expect(gap, sections[index]!.tagName).toBeCloseTo(16, 1);
    }
    expect(Math.abs(rect.bottom - 1 - 24 - sections.at(-1)!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
  });

  it('puts the allowed-site field and Add site on one row at one height and one top', async () => {
    await page.viewport(1280, 720);
    const { byId } = await mountOptions();
    const field = byId('allowlist-entry').getBoundingClientRect();
    const add = byId('allowlist-form').querySelector('button')!.getBoundingClientRect();
    expect(add.top).toBe(field.top);
    expect(add.height).toBe(field.height);
  });

  it('shows each site on one line with Remove as danger text at its end, and Save settings as the one primary in a footer row with the status at the start', async () => {
    await page.viewport(1280, 720);
    const { main, byId } = await mountOptions();
    const rows = [...byId('allowlist').children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    const danger = color(getComputedStyle(main).getPropertyValue('--annotation-color-danger').trim());
    for (const row of rows) {
      const remove = row.querySelector('button')!;
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(44);
      expect(remove.dataset.variant).toBe('danger');
      const style = getComputedStyle(remove);
      expect(color(style.color)).toEqual(danger);
      expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(style.borderTopWidth).toBe('0px');
      expect(row.getBoundingClientRect().right - remove.getBoundingClientRect().right).toBeLessThanOrEqual(12);
    }

    const save = byId('save');
    byId('status').textContent = 'Settings saved.';
    expect(save.dataset.variant).toBe('primary');
    expect(main.querySelectorAll('button[data-variant="primary"]')).toHaveLength(1);
    expect(color(getComputedStyle(save).backgroundColor)).toEqual(color(getComputedStyle(main).getPropertyValue('--annotation-color-accent').trim()));
    const footer = save.parentElement!;
    expect(footer).not.toBe(main);
    expect(byId('status').parentElement).toBe(footer);
    const [status, button] = [byId('status').getBoundingClientRect(), save.getBoundingClientRect()];
    expect(status.right).toBeLessThanOrEqual(button.left);
    expect(Math.abs(status.top + status.height / 2 - (button.top + button.height / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(footer.getBoundingClientRect().right - button.right - 0)).toBeLessThanOrEqual(1);
  });
});
