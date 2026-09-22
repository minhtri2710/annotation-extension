import { browser } from 'wxt/browser';
import { listAnnotations } from '../lib/annotation-storage';
import { createNotePanel } from '../lib/notes/note-panel';
import { createPinsController, type PinsController } from '../lib/pins/pins';
import type { ElementContext } from '../lib/capture/context';
import { buildOverlayShell } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
import { pageKey } from '../utils/page-key';
import {
  createCaptureController,
  isCaptureToggleMessage,
  type CaptureEvents,
} from '../lib/capture';

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    const bus = createEventBus<CaptureEvents>();
    let controller: ReturnType<typeof createCaptureController> | undefined;
    let pins: PinsController | undefined;
    let unsubscribeSelection: (() => void) | undefined;
    let unsubscribeCaptureState: (() => void) | undefined;
    let storageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] | undefined;
    let runtimeMessageListener: ((message: unknown) => void) | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      position: 'inline',
      onMount: (container, _shadow, shadowHost) => {
        const shell = buildOverlayShell(container, {
          theme: 'system',
          prefersDark: () =>
            typeof window.matchMedia === 'function'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : undefined,
        });
        const notePanel = createNotePanel(shell.panel);
        unsubscribeSelection = bus.on('element:selected', (context) => {
          void notePanel.render(context);
        });
        pins = createPinsController({
          document,
          container: shell.root,
          toolbar: shell.toolbar,
          onActivate: (annotation) => {
            void notePanel.render(annotation.elementContext as unknown as ElementContext);
          },
        });
        const url = document.location.href;
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
