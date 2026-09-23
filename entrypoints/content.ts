import { browser } from 'wxt/browser';
import { listAnnotations } from '../lib/annotation-storage';
import { ANNOTATION_EDIT_EVENT, createAnnotationList } from '../lib/annotation-list/annotation-list';
import { createNotePanel, NOTE_PANEL_CLOSE_EVENT } from '../lib/notes/note-panel';
import { createScanPanel, deepScanPage, scanPage } from '../lib/scan-panel/scan-panel';
import { createPinsController, type PinsController } from '../lib/pins/pins';
import type { ElementContext } from '../lib/capture/context';
import type { Annotation } from '../lib/annotation';
import { resolveLiveElementContext } from '../lib/wiring/live-element';
import { watchRoute } from '../lib/wiring/route-watch';
import { buildOverlayShell, createPanelAnchor, raiseOverlay, type PanelAnchor } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
import { createToolbarControls } from '../lib/ui/toolbar-controls';
import { readToolbarPrefs, writeToolbarPrefs } from '../lib/ui/ui-prefs';
import { pageKey } from '../utils/page-key';
import { isEnabledForUrl } from '../lib/options/policy';
import { readPolicy, SITE_POLICY_STORAGE_KEY } from '../lib/options/storage';
import {
  createCaptureController,
  interceptPageEvents,
  isCaptureToggleMessage,
  type CaptureEvents,
} from '../lib/capture';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main(ctx) {
    // The only work before the DOM exists: capture listeners that must precede the page's own.
    interceptPageEvents(window);
    await domReady();

    const bus = createEventBus<CaptureEvents>();
    let controller: ReturnType<typeof createCaptureController> | undefined;
    let notePanel: ReturnType<typeof createNotePanel> | undefined;
    let pins: PinsController | undefined;
    let unsubscribeSelection: (() => void) | undefined;
    let unsubscribeCaptureState: (() => void) | undefined;
    type StorageListener = Parameters<typeof browser.storage.onChanged.addListener>[0];
    let storageChanged: StorageListener | undefined;
    let runtimeMessageListener: ((message: unknown) => void) | undefined;
    let annotationListToggle: HTMLButtonElement | undefined;
    let scanToggleButton: HTMLButtonElement | undefined;
    let scanPanel: ReturnType<typeof createScanPanel> | undefined;
    let annotationToggle: HTMLButtonElement | undefined;
    let panelAnchor: PanelAnchor | undefined;
    let stopRouteWatch: (() => void) | undefined;
    let toolbarControls: ReturnType<typeof createToolbarControls> | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      position: 'overlay',
      alignment: 'bottom-right',
      onMount: (container, _shadow, shadowHost) => {
        const shell = buildOverlayShell(container, {
          theme: 'system',
          prefersDark: () =>
            typeof window.matchMedia === 'function'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : undefined,
        });
        let url = document.location.href;
        const activeNotePanel = createNotePanel(shell.panel);
        notePanel = activeNotePanel;
        let annotationList = createAnnotationList(shell.panel, url);
        const activeScanPanel = createScanPanel(shell.panel, {
          scan: (signal) => scanPage(window, shadowHost, signal),
          deepScan: (signal, onProgress) => deepScanPage(window, shadowHost, signal, onProgress),
          onUpdate: () => {
            if (panelMode === 'scan') activePanelAnchor.place(anchorToToolbar);
          },
          highlightRoot: shell.root,
        });
        scanPanel = activeScanPanel;
        // Live regions sit outside the panel mount so they persist while panels re-render and close.
        shell.root.append(activeNotePanel.live, annotationList.live, activeScanPanel.live);
        const overlayRoot = shell.root.getRootNode() as Document | ShadowRoot;
        const PANEL_LABELS = { note: 'Annotation note', list: 'Annotations on this page', scan: 'Page scan' } as const;
        let panelMode: 'none' | keyof typeof PANEL_LABELS = 'none';
        let panelOpener: HTMLElement | undefined;
        let renderSequence = 0;
        const activePanelAnchor = createPanelAnchor(shell.panel, shell.toolbar);
        panelAnchor = activePanelAnchor;
        const anchorToToolbar = () => shell.toolbar.getBoundingClientRect();
        const scanToggle = document.createElement('button');
        scanToggleButton = scanToggle;
        scanToggle.type = 'button';
        scanToggle.dataset.annotationScanToggle = '';
        scanToggle.setAttribute('aria-expanded', 'false');
        scanToggle.textContent = 'Scan';
        const listToggle = document.createElement('button');
        const resetPanel = () => {
          if (panelMode === 'note') activeNotePanel.clear();
          if (panelMode === 'list') annotationList.clear();
          if (panelMode === 'scan') activeScanPanel.clear();
          listToggle.setAttribute('aria-expanded', 'false');
          scanToggle.setAttribute('aria-expanded', 'false');
          shell.panel.removeAttribute('aria-label');
          activePanelAnchor.clear();
          panelMode = 'none';
          panelOpener = undefined;
        };
        const setPanelMode = (mode: keyof typeof PANEL_LABELS, opener: HTMLElement | undefined) => {
          panelMode = mode;
          panelOpener = opener;
          shell.panel.setAttribute('aria-label', PANEL_LABELS[mode]);
        };
        // Focus returns to the opener only if it was inside the panel; focus elsewhere is left alone.
        const closePanel = () => {
          const focusWasInPanel = shell.panel.contains(overlayRoot.activeElement);
          const opener = panelOpener;
          resetPanel();
          if (focusWasInPanel && opener?.isConnected) opener.focus();
        };
        const openPanel = (mode: 'list' | 'scan') => {
          if (panelMode === mode) {
            closePanel();
            return;
          }
          resetPanel();
          const toggle = mode === 'list' ? listToggle : scanToggle;
          setPanelMode(mode, toggle);
          const sequence = ++renderSequence;
          toggle.setAttribute('aria-expanded', 'true');
          void (mode === 'list' ? annotationList.render() : activeScanPanel.render()).then(() => {
            if (sequence !== renderSequence || panelMode !== mode) return;
            activePanelAnchor.place(anchorToToolbar);
          });
        };
        scanToggle.addEventListener('click', () => openPanel('scan'));
        shell.toolbar.append(scanToggle);

        annotationListToggle = listToggle;
        listToggle.type = 'button';
        listToggle.dataset.annotationListToggle = '';
        listToggle.setAttribute('aria-expanded', 'false');
        listToggle.textContent = 'View all';
        listToggle.addEventListener('click', () => openPanel('list'));
        shell.toolbar.append(listToggle);

        const annotateToggle = document.createElement('button');
        annotationToggle = annotateToggle;
        annotateToggle.type = 'button';
        annotateToggle.dataset.annotationToggle = '';
        annotateToggle.setAttribute('aria-pressed', 'false');
        annotateToggle.textContent = 'Annotate';
        annotateToggle.addEventListener('click', () => controller?.toggle());
        shell.toolbar.append(annotateToggle);

        const showNotePanel = (context: ElementContext, opener: HTMLElement | undefined) => {
          resetPanel();
          setPanelMode('note', opener);
          const sequence = ++renderSequence;
          void activeNotePanel.render(context).then(() => {
            if (sequence !== renderSequence || panelMode !== 'note') return;
            activePanelAnchor.place(() => context.boundingBox);
          });
        };
        unsubscribeSelection = bus.on('element:selected', (context) => {
          showNotePanel(context, annotateToggle);
        });
        pins = createPinsController({
          document,
          container: shell.root,
          toolbar: shell.toolbar,
          onActivate: (annotation) => {
            const context = resolveLiveElementContext(document, annotation);
            const pin = overlayRoot.activeElement as HTMLElement | null;
            if (context) showNotePanel(context, pin && !shell.panel.contains(pin) ? pin : undefined);
          },
        });
        // A row's control is gone once the list closes, so the note panel returns focus to the list's opener.
        shell.panel.addEventListener(ANNOTATION_EDIT_EVENT, (event) => {
          const annotation = (event as CustomEvent<Annotation>).detail;
          showNotePanel(resolveLiveElementContext(document, annotation) ?? annotation.elementContext, panelOpener);
        });
        shell.panel.addEventListener(NOTE_PANEL_CLOSE_EVENT, () => {
          if (panelMode === 'note') closePanel();
        });
        shell.panel.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape' || panelMode === 'none') return;
          // The first Escape during a deep scan only cancels it (scan-panel's document listener).
          if (panelMode === 'scan' && activeScanPanel.isDeepScanRunning()) return;
          event.stopPropagation();
          closePanel();
        });
        toolbarControls = createToolbarControls({
          toolbar: shell.toolbar,
          win: window,
          prefs: { read: readToolbarPrefs, write: writeToolbarPrefs },
          onCollapsedChange: (collapsed) => {
            if (collapsed && panelMode !== 'none') closePanel();
          },
          onPositionChange: () => {
            if (panelMode === 'list' || panelMode === 'scan') activePanelAnchor.place(anchorToToolbar);
          },
        });
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
          if (panelMode !== 'none') closePanel();
          const nextList = createAnnotationList(shell.panel, newUrl);
          annotationList.live.replaceWith(nextList.live);
          annotationList = nextList;
          void refreshPins();
        });
        const activeController = createCaptureController({
          document,
          shadowHost,
          bus,
        });
        controller = activeController;
        shell.root.append(activeController.live);
        runtimeMessageListener = (message) => {
          if (isCaptureToggleMessage(message)) controller?.toggle();
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
        stopRouteWatch?.();
        stopRouteWatch = undefined;
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
    const policyChanged: StorageListener = (changes, areaName) => {
      if (areaName === 'local' && SITE_POLICY_STORAGE_KEY in changes) void applyPolicy();
    };
    browser.storage.onChanged.addListener(policyChanged);
    ctx.onInvalidated(() => browser.storage.onChanged.removeListener(policyChanged));
    await applyPolicy();
  },
});

function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
