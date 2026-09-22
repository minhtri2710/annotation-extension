import { browser } from 'wxt/browser';
import { buildOverlayShell } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
import { createNotePanel } from '../lib/notes/note-panel';
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
    let unsubscribeSelection: (() => void) | undefined;

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
        controller?.destroy();
        controller = undefined;
      },
    });

    ui.mount();
    browser.runtime.onMessage.addListener((message) => {
      if (isCaptureToggleMessage(message)) controller?.toggle();
    });
    bus.on('capture:active', (active) => {
      ui.shadowHost.toggleAttribute('data-annotation-active', active);
    });
  },
});
