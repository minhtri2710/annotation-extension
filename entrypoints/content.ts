import { browser } from 'wxt/browser';
import { listAnnotations } from '../lib/annotation-storage';
import { ANNOTATION_EDIT_EVENT, ANNOTATION_LIST_CLOSE_EVENT, ANNOTATION_START_EVENT, createAnnotationList } from '../lib/annotation-list/annotation-list';
import { createNotePanel, NOTE_PANEL_CLOSE_EVENT } from '../lib/notes/note-panel';
import { ANNOTATION_SCAN_CLOSE_EVENT, createScanPanel, deepScanPage, scanPage } from '../lib/scan-panel/scan-panel';
import { createPinsController, type PinsController } from '../lib/pins/pins';
import { extractElementContext } from '../lib/capture/context';
import type { Annotation } from '../lib/annotation';
import { resolveLiveElementContext } from '../lib/wiring/live-element';
import { createPanelMode } from '../lib/wiring/panel-mode';
import { watchRoute } from '../lib/wiring/route-watch';
import { buildOverlayShell, createPanelAnchor, raiseOverlay, setToolbarHidden, type PanelAnchor } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
import { setIconButton } from '../lib/ui/icons';
import { createToolbarControls } from '../lib/ui/toolbar-controls';
import { readToolbarPrefs, writeToolbarPrefs } from '../lib/ui/ui-prefs';
import { isToolbarChangedMessage, readToolbarTab, setToolbarTab } from '../lib/wiring/toolbar-tab-messages';
import { watchColorScheme } from '../lib/ui/theme';
import { pageKey } from '../utils/page-key';
import { isEnabledForUrl } from '../lib/options/policy';
import { readPolicy, SITE_POLICY_STORAGE_KEY } from '../lib/options/storage';
import {
  createCaptureController,
  guardUntrustedOverlayEvents,
  interceptPageEvents,
  isCaptureStateMessage,
  isCaptureToggleMessage,
  releasePageEvents,
  type CaptureEvents,
} from '../lib/capture';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main(ctx) {
    // The only work before the DOM exists: capture listeners that must precede the page's own.
    interceptPageEvents(window);
    ctx.onInvalidated(() => releasePageEvents(window));
    await domReady();

    const bus = createEventBus<CaptureEvents>();
    let controller: ReturnType<typeof createCaptureController> | undefined;
    let notePanel: ReturnType<typeof createNotePanel> | undefined;
    let pins: PinsController | undefined;
    let unsubscribeSelection: (() => void) | undefined;
    let unsubscribeCaptureState: (() => void) | undefined;
    type StorageListener = Parameters<typeof browser.storage.onChanged.addListener>[0];
    let storageChanged: StorageListener | undefined;
    let runtimeMessageListener:
      | ((message: unknown, _sender: unknown, sendResponse: (response: { active: boolean }) => void) => void)
      | undefined;
    let annotationListToggle: HTMLButtonElement | undefined;
    let scanToggleButton: HTMLButtonElement | undefined;
    let scanPanel: ReturnType<typeof createScanPanel> | undefined;
    let annotationToggle: HTMLButtonElement | undefined;
    let panelAnchor: PanelAnchor | undefined;
    let stopRouteWatch: (() => void) | undefined;
    let clearAnnotationList: (() => void) | undefined;
    let stopColorScheme: (() => void) | undefined;
    let toolbarControls: ReturnType<typeof createToolbarControls> | undefined;
    let stopOverlayGuard: (() => void) | undefined;
    // The bar belongs to the tab and is off until the background says this tab turned it on, so an overlay
    // mounts with the bar hidden and never shows it for a frame. A later change wins over a read still pending.
    let toolbarOn = false;
    let toolbarSequence = 0;
    let applyToolbar: ((on: boolean) => void) | undefined;
    const showToolbar = (on: boolean) => {
      toolbarSequence++;
      toolbarOn = on;
      applyToolbar?.(on);
    };
    // Annotating is never active in a tab whose bar is off: the background turns this tab on first, and a
    // failed turn-on starts nothing.
    const toggleCapture = () => {
      if (toolbarOn) {
        controller?.toggle();
        return;
      }
      void setToolbarTab(true).then(
        () => {
          if (ctx.isInvalid) return;
          showToolbar(true);
          controller?.activate();
        },
        () => undefined,
      );
    };

    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      mode: 'closed',
      position: 'overlay',
      alignment: 'bottom-right',
      onMount: (container, _shadow, shadowHost) => {
        stopOverlayGuard = guardUntrustedOverlayEvents(_shadow);
        const shell = buildOverlayShell(container);
        stopColorScheme = watchColorScheme(shell.root, window);
        let url = document.location.href;
        const activeNotePanel = createNotePanel(shell.panel);
        notePanel = activeNotePanel;
        let annotationList = createAnnotationList(shell.panel, url);
        clearAnnotationList = () => annotationList.clear();
        const activeScanPanel = createScanPanel(shell.panel, {
          scan: (signal) => scanPage(window, shadowHost, signal),
          deepScan: (signal, onProgress) => deepScanPage(window, shadowHost, signal, onProgress),
          highlightRoot: shell.root,
          // The row's button is gone once the scan panel closes, so the note panel returns focus to the Scan toggle.
          onAnnotate: (el, finding) => panels.showNote(extractElementContext(el), scanToggle, `${finding.name}: ${finding.detail}`),
        });
        scanPanel = activeScanPanel;
        // Live regions sit outside the panel mount so they persist while panels re-render and close.
        shell.root.append(activeNotePanel.live, annotationList.live, activeScanPanel.live);
        const overlayRoot = shell.root.getRootNode() as Document | ShadowRoot;
        const activePanelAnchor = createPanelAnchor(shell.panel, shell.toolbar);
        panelAnchor = activePanelAnchor;
        const anchorToToolbar = () => shell.toolbar.getBoundingClientRect();
        const scanToggle = document.createElement('button');
        scanToggleButton = scanToggle;
        scanToggle.type = 'button';
        scanToggle.dataset.annotationScanToggle = '';
        scanToggle.setAttribute('aria-expanded', 'false');
        setIconButton(scanToggle, 'scan', 'Scan');
        const listToggle = document.createElement('button');
        const panels = createPanelMode({
          panel: shell.panel,
          overlayRoot,
          anchor: activePanelAnchor,
          anchorToToolbar,
          notePanel: activeNotePanel,
          scanPanel: activeScanPanel,
          annotationList: () => annotationList,
          listToggle,
          scanToggle,
        });
        scanToggle.addEventListener('click', () => panels.toggle('scan'));
        shell.toolbar.append(scanToggle);

        annotationListToggle = listToggle;
        listToggle.type = 'button';
        listToggle.dataset.annotationListToggle = '';
        listToggle.setAttribute('aria-expanded', 'false');
        setIconButton(listToggle, 'list', 'View all');
        listToggle.addEventListener('click', () => panels.toggle('list'));
        shell.toolbar.append(listToggle);

        const annotateToggle = document.createElement('button');
        annotationToggle = annotateToggle;
        annotateToggle.type = 'button';
        annotateToggle.dataset.annotationToggle = '';
        annotateToggle.dataset.variant = 'primary';
        annotateToggle.setAttribute('aria-pressed', 'false');
        annotateToggle.textContent = 'Annotate';
        annotateToggle.addEventListener('click', () => controller?.toggle());
        shell.toolbar.append(annotateToggle);

        unsubscribeSelection = bus.on('element:selected', (context) => {
          panels.showNote(context, annotateToggle);
        });
        pins = createPinsController({
          document,
          container: shell.root,
          toolbar: shell.toolbar,
          badgeHost: listToggle,
          onActivate: (annotation) => {
            const context = resolveLiveElementContext(document, annotation);
            const pin = overlayRoot.activeElement as HTMLElement | null;
            if (context) panels.showNote(context, pin && !shell.panel.contains(pin) ? pin : undefined);
          },
        });
        // A row's control is gone once the list closes, so the note panel returns focus to the list's opener.
        shell.panel.addEventListener(ANNOTATION_EDIT_EVENT, (event) => {
          const annotation = (event as CustomEvent<Annotation>).detail;
          panels.showNote(resolveLiveElementContext(document, annotation) ?? annotation.elementContext, panels.opener());
        });
        shell.panel.addEventListener(ANNOTATION_START_EVENT, () => {
          panels.close();
          controller?.activate();
        });
        shell.panel.addEventListener(NOTE_PANEL_CLOSE_EVENT, () => {
          if (panels.mode() === 'note') panels.close();
        });
        shell.panel.addEventListener(ANNOTATION_LIST_CLOSE_EVENT, () => {
          if (panels.mode() === 'list') panels.close();
        });
        shell.panel.addEventListener(ANNOTATION_SCAN_CLOSE_EVENT, () => {
          if (panels.mode() === 'scan') panels.close();
        });
        shell.panel.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape' || panels.mode() === 'none') return;
          // The first Escape during a deep scan only cancels it (scan-panel's document listener).
          if (panels.mode() === 'scan' && activeScanPanel.isDeepScanRunning()) return;
          event.stopPropagation();
          panels.close();
        });
        toolbarControls = createToolbarControls({
          toolbar: shell.toolbar,
          win: window,
          prefs: { read: readToolbarPrefs, write: writeToolbarPrefs },
          onCollapsedChange: (collapsed) => {
            if (collapsed && panels.mode() !== 'none') panels.close();
          },
          onPositionChange: () => {
            const mode = panels.mode();
            if (mode === 'list' || mode === 'scan') activePanelAnchor.place(anchorToToolbar);
          },
        });
        // The overlay stays mounted while the bar is off. Annotating never runs without the bar, and only a
        // list or scan panel, which anchor to the bar, close; an open note panel stays.
        applyToolbar = (on) => {
          if (!on) {
            controller?.deactivate();
            const mode = panels.mode();
            if (mode === 'list' || mode === 'scan') panels.close();
          }
          setToolbarHidden(shell.toolbar, !on);
        };
        applyToolbar(toolbarOn);
        let pinsSequence = 0;
        const refreshPins = async () => {
          const sequence = ++pinsSequence;
          const annotations = await listAnnotations(url);
          if (sequence !== pinsSequence) return;
          pins?.setAnnotations(annotations);
        };
        storageChanged = (changes, areaName) => {
          if (areaName !== 'local' || !(pageKey(url) in changes)) return;
          void refreshPins();
          void activeNotePanel.syncWithStorage();
        };
        browser.storage.onChanged.addListener(storageChanged);
        void refreshPins();
        stopRouteWatch = watchRoute(window, (newUrl) => {
          url = newUrl;
          if (panels.mode() !== 'none') panels.close();
          const nextList = createAnnotationList(shell.panel, newUrl);
          annotationList.live.replaceWith(nextList.live);
          annotationList = nextList;
          void refreshPins();
        });
        const activeController = createCaptureController({
          document,
          shadowHost,
          shadowRoot: _shadow,
          bus,
        });
        controller = activeController;
        shell.root.append(activeController.live);
        runtimeMessageListener = (message, _sender, sendResponse) => {
          if (isCaptureStateMessage(message)) sendResponse({ active: controller?.active ?? false });
          if (isCaptureToggleMessage(message)) toggleCapture();
        };
        browser.runtime.onMessage.addListener(runtimeMessageListener);
        unsubscribeCaptureState = bus.on('capture:active', (active) => {
          shadowHost.toggleAttribute('data-annotation-active', active);
          annotateToggle.setAttribute('aria-pressed', String(active));
          annotateToggle.toggleAttribute('data-active', active);
          annotateToggle.textContent = active ? 'Stop annotating' : 'Annotate';
        });
        return shell;
      },
      onRemove: () => {
        stopOverlayGuard?.();
        stopOverlayGuard = undefined;
        stopRouteWatch?.();
        stopRouteWatch = undefined;
        stopColorScheme?.();
        stopColorScheme = undefined;
        unsubscribeSelection?.();
        unsubscribeSelection = undefined;
        unsubscribeCaptureState?.();
        unsubscribeCaptureState = undefined;
        if (storageChanged) {
          browser.storage.onChanged.removeListener(storageChanged);
          storageChanged = undefined;
        }
        if (runtimeMessageListener) {
          browser.runtime.onMessage.removeListener(runtimeMessageListener);
          runtimeMessageListener = undefined;
        }
        scanPanel?.clear();
        scanPanel = undefined;
        clearAnnotationList?.();
        clearAnnotationList = undefined;
        scanToggleButton?.remove();
        scanToggleButton = undefined;
        annotationListToggle?.remove();
        annotationListToggle = undefined;
        annotationToggle?.remove();
        annotationToggle = undefined;
        panelAnchor?.destroy();
        panelAnchor = undefined;
        notePanel?.teardown();
        notePanel = undefined;
        applyToolbar = undefined;
        toolbarControls?.destroy();
        toolbarControls = undefined;
        pins?.destroy();
        pins = undefined;
        controller?.destroy();
        controller = undefined;
      },
    });

    // An open tab follows the site policy: disallowing the page tears the overlay down as leaving does,
    // allowing it mounts the overlay without a reload. The latest read wins.
    let policySequence = 0;
    const applyPolicy = async () => {
      const sequence = ++policySequence;
      const policy = await readPolicy();
      if (sequence !== policySequence || ctx.isInvalid) return;
      const enabled = isEnabledForUrl(location.href, policy);
      if (enabled && !ui.mounted) {
        ui.mount();
        raiseOverlay(ui.shadowHost);
      } else if (!enabled && ui.mounted) {
        ui.remove();
      }
    };
    const settingsChanged: StorageListener = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (SITE_POLICY_STORAGE_KEY in changes) void applyPolicy();
    };
    browser.storage.onChanged.addListener(settingsChanged);
    ctx.onInvalidated(() => browser.storage.onChanged.removeListener(settingsChanged));
    await applyPolicy();

    // The tab's state is tracked whether or not the overlay is mounted, so an overlay the site policy mounts later shows it.
    const toolbarChanged = (message: unknown) => {
      if (isToolbarChangedMessage(message)) showToolbar(message.on);
    };
    browser.runtime.onMessage.addListener(toolbarChanged);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(toolbarChanged));
    // A change that arrives during a read is newer than the read. An unreadable state stays off.
    const readToolbarState = () => {
      const readSequence = toolbarSequence;
      void readToolbarTab().then(
        (on) => {
          if (readSequence === toolbarSequence && !ctx.isInvalid) showToolbar(on);
        },
        () => undefined,
      );
    };
    readToolbarState();
    // A page restored from the back/forward cache keeps the state it left with, and no message reaches a cached
    // document, so the tab's current state is read again.
    const pageShown = (event: PageTransitionEvent) => {
      if (event.persisted) readToolbarState();
    };
    window.addEventListener('pageshow', pageShown);
    ctx.onInvalidated(() => window.removeEventListener('pageshow', pageShown));
  },
});

function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
