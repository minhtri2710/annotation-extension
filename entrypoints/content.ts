import { buildOverlayShell } from '../lib/ui/shell';

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      position: 'inline',
      onMount: (container) =>
        buildOverlayShell(container, {
          theme: 'system',
          prefersDark: () =>
            typeof window.matchMedia === 'function'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : undefined,
        }),
    });

    ui.mount();
  },
});
