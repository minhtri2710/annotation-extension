import { browser } from 'wxt/browser';
import { listAnnotations } from '../lib/annotation-storage';
import { createAnnotationList } from '../lib/annotation-list/annotation-list';
import { createNotePanel } from '../lib/notes/note-panel';
import { createScanPanel, deepScanPage, scanPage } from '../lib/scan-panel/scan-panel';
import { createPinsController, type PinsController } from '../lib/pins/pins';
import type { ElementContext } from '../lib/capture/context';
import { resolveLiveElementContext } from '../lib/wiring/live-element';
import { watchRoute } from '../lib/wiring/route-watch';
import { buildOverlayShell, positionPopover } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
import { createToolbarControls } from '../lib/ui/toolbar-controls';
import { readToolbarPrefs, writeToolbarPrefs } from '../lib/ui/ui-prefs';
import { pageKey } from '../utils/page-key';
import { isEnabledForUrl } from '../lib/options/policy';
import { readPolicy } from '../lib/options/storage';
import {
  createCaptureController,
  isCaptureToggleMessage,
  type CaptureEvents,
} from '../lib/capture';

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    const policy = await readPolicy();
    if (!isEnabledForUrl(location.href, policy)) return;

    const bus = createEventBus<CaptureEvents>();
    let controller: ReturnType<typeof createCaptureController> | undefined;
    let notePanel: ReturnType<typeof createNotePanel> | undefined;
    let pins: PinsController | undefined;
    let unsubscribeSelection: (() => void) | undefined;
    let unsubscribeCaptureState: (() => void) | undefined;
    let storageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] | undefined;
    let runtimeMessageListener: ((message: unknown) => void) | undefined;
    let annotationListToggle: HTMLButtonElement | undefined;
    let scanToggleButton: HTMLButtonElement | undefined;
    let scanPanel: ReturnType<typeof createScanPanel> | undefined;
    let annotationToggle: HTMLButtonElement | undefined;
    let resetPanelPosition: (() => void) | undefined;
    let stopRouteWatch: (() => void) | undefined;
    let toolbarControls: ReturnType<typeof createToolbarControls> | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      position: 'overlay',
      alignment: 'bottom-right',
      zIndex: 2147483646,
      onMount: (container, _shadow, shadowHost) => {
        const shell = buildOverlayShell(container, {
          theme: 'system',
          prefersDark: () =>
            typeof window.matchMedia === 'function'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : undefined,
        });
        let url = document.location.href;
        notePanel = createNotePanel(shell.panel);
        let annotationList = createAnnotationList(shell.panel, url);
        const activeScanPanel = createScanPanel(shell.panel, {
          scan: () => scanPage(window, shadowHost),
          deepScan: (signal) => deepScanPage(window, shadowHost, signal),
          onUpdate: () => {
            if (panelMode === 'scan') anchorPanel(shell.toolbar.getBoundingClientRect());
          },
          highlightRoot: shell.root,
        });
        scanPanel = activeScanPanel;
        let panelMode: 'none' | 'list' | 'scan' = 'none';
        let renderSequence = 0;
        resetPanelPosition = () => {
          shell.panel.style.removeProperty('position');
          shell.panel.style.removeProperty('top');
          shell.panel.style.removeProperty('left');
          shell.panel.style.removeProperty('right');
          shell.panel.style.removeProperty('bottom');
        };
        const anchorPanel = (box: { x: number; y: number; width: number; height: number }) => {
          const { width, height } = shell.panel.getBoundingClientRect();
          const { top, left } = positionPopover(
            box,
            { width, height },
            { width: window.innerWidth, height: window.innerHeight },
          );
          shell.panel.style.position = 'fixed';
          shell.panel.style.top = `${top}px`;
          shell.panel.style.left = `${left}px`;
          shell.panel.style.right = 'auto';
          shell.panel.style.bottom = 'auto';
        };
        const scanToggle = document.createElement('button');
        scanToggleButton = scanToggle;
        scanToggle.type = 'button';
        scanToggle.dataset.annotationScanToggle = '';
        scanToggle.setAttribute('aria-expanded', 'false');
        scanToggle.textContent = 'Scan';
        const listToggle = document.createElement('button');
        const closePanel = () => {
          if (panelMode === 'list') annotationList.clear();
          if (panelMode === 'scan') activeScanPanel.clear();
          listToggle.setAttribute('aria-expanded', 'false');
          scanToggle.setAttribute('aria-expanded', 'false');
          resetPanelPosition?.();
          panelMode = 'none';
        };
        const openPanel = (mode: 'list' | 'scan') => {
          const wasOpen = panelMode === mode;
          closePanel();
          if (wasOpen) return;
          panelMode = mode;
          const sequence = ++renderSequence;
          (mode === 'list' ? listToggle : scanToggle).setAttribute('aria-expanded', 'true');
          void (mode === 'list' ? annotationList.render() : activeScanPanel.render()).then(() => {
            if (sequence !== renderSequence || panelMode !== mode) return;
            anchorPanel(shell.toolbar.getBoundingClientRect());
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

        const showNotePanel = (context: ElementContext) => {
          if (panelMode !== 'none') closePanel();
          const sequence = ++renderSequence;
          const panel = notePanel;
          if (!panel) return;
          void panel.render(context).then(() => {
            if (sequence !== renderSequence) return;
            anchorPanel(context.boundingBox);
          });
        };
        unsubscribeSelection = bus.on('element:selected', (context) => {
          showNotePanel(context);
        });
        pins = createPinsController({
          document,
          container: shell.root,
          toolbar: shell.toolbar,
          onActivate: (annotation) => {
            const context = resolveLiveElementContext(document, annotation);
            if (context) showNotePanel(context);
          },
        });
        toolbarControls = createToolbarControls({
          toolbar: shell.toolbar,
          win: window,
          prefs: { read: readToolbarPrefs, write: writeToolbarPrefs },
          onCollapsedChange: (collapsed) => {
            if (collapsed && panelMode !== 'none') closePanel();
          },
          onPositionChange: () => {
            if (panelMode !== 'none') anchorPanel(shell.toolbar.getBoundingClientRect());
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
          if (areaName === 'local' && pageKey(url) in changes) void refreshPins();
        };
        browser.storage.onChanged.addListener(storageChanged);
        void refreshPins();
        stopRouteWatch = watchRoute(window, (newUrl) => {
          url = newUrl;
          if (panelMode !== 'none') closePanel();
          annotationList = createAnnotationList(shell.panel, newUrl);
          void refreshPins();
        });
        controller = createCaptureController({
          document,
          shadowHost,
          bus,
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
        resetPanelPosition?.();
        resetPanelPosition = undefined;
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

    ui.mount();
    runtimeMessageListener = (message) => {
      if (isCaptureToggleMessage(message)) controller?.toggle();
    };
    browser.runtime.onMessage.addListener(runtimeMessageListener);
    unsubscribeCaptureState = bus.on('capture:active', (active) => {
      ui.shadowHost.toggleAttribute('data-annotation-active', active);
      annotationToggle?.setAttribute('aria-pressed', String(active));
      annotationToggle?.toggleAttribute('data-active', active);
      if (annotationToggle) annotationToggle.textContent = active ? 'Stop annotating' : 'Annotate';
    });
  },
});
