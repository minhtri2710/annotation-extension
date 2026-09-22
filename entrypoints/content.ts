export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'annotation-extension-root',
      position: 'inline',
      onMount: (container) => container,
    });

    ui.mount();
  },
});
