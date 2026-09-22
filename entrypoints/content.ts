import { browser } from 'wxt/browser';
import { listAnnotations } from '../lib/annotation-storage';
import { createAnnotationList } from '../lib/annotation-list/annotation-list';
import { createNotePanel } from '../lib/notes/note-panel';
import { createPinsController, type PinsController } from '../lib/pins/pins';
import type { ElementContext } from '../lib/capture/context';
import { buildOverlayShell } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
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
        const url = document.location.href;
        notePanel = createNotePanel(shell.panel);
        const annotationList = createAnnotationList(shell.panel, url);
        let listOpen = false;
        const listToggle = document.createElement('button');
        annotationListToggle = listToggle;
        listToggle.type = 'button';
        listToggle.dataset.annotationListToggle = '';
        listToggle.setAttribute('aria-expanded', 'false');
        listToggle.textContent = 'View all';
        listToggle.addEventListener('click', () => {
          listOpen = !listOpen;
          listToggle.setAttribute('aria-expanded', String(listOpen));
          if (listOpen) void annotationList.render();
          else annotationList.clear();
        });
        shell.toolbar.append(listToggle);

        const showNotePanel = (context: ElementContext) => {
          if (listOpen) {
            listOpen = false;
            listToggle.setAttribute('aria-expanded', 'false');
            annotationList.clear();
          }
          void notePanel.render(context);
        };
        unsubscribeSelection = bus.on('element:selected', (context) => {
          showNotePanel(context);
        });
        pins = createPinsController({
          document,
          container: shell.root,
          toolbar: shell.toolbar,
          onActivate: (annotation) => {
            showNotePanel(annotation.elementContext as unknown as ElementContext);
          },
        });
        const refreshPins = async () => {
          const annotations = await listAnnotations(url);
          pins?.setAnnotations(annotations);
        };
        storageChanged = (changes, areaName) => {
          if (areaName === 'local' && pageKey(url) in changes) void refreshPins();
        };
        browser.storage.onChanged.addListener(storageChanged);
        void refreshPins();
        controller = createCaptureController({
          document,
          shadowHost,
          bus,
        });
        return shell;
      },
      onRemove: () => {
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
        annotationListToggle?.remove();
        annotationListToggle = undefined;
        notePanel?.teardown();
        notePanel = undefined;
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
    });
  },
});
