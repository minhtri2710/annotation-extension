import { browser } from 'wxt/browser';
import { buildOverlayShell } from '../lib/ui/shell';
import { createEventBus } from '../lib/ui/event-bus';
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
        controller = createCaptureController({
          document,
          shadowHost,
          panel: shell.panel,
          bus,
        });
        return shell;
      },
      onRemove: () => {
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
