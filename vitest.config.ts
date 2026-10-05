import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest's virtual:wxt-setup module (wxt:extension-api-mock plugin, wxt 0.21.4) cannot load in vitest browser mode, so its setupFiles entry is dropped.
// wxt/browser still aliases to fakeBrowser; no browser spec uses the chrome/browser globals it stubs.
// Delete this wrapper and use WxtVitest() directly once that setup module loads in browser mode.
async function wxtBrowserPlugins(): Promise<Plugin[]> {
  return ((await WxtVitest()) as Plugin[]).map((plugin) => {
    if (plugin.name !== 'wxt:extension-api-mock') return plugin;
    const config = plugin.config as () => Record<string, unknown>;
    return {
      ...plugin,
      config: () => {
        const { test: _setup, ...rest } = config();
        return rest;
      },
    };
  });
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [WxtVitest()],
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
        },
      },
      {
        plugins: [wxtBrowserPlugins()],
        optimizeDeps: {
          include: [
            'wxt/testing/fake-browser',
            'wxt/utils/content-script-context',
            'wxt/utils/content-script-ui/shadow-root',
            'wxt/utils/define-content-script',
            'wxt/utils/storage',
          ],
        },
        test: {
          name: 'browser',
          setupFiles: ['./vitest.setup.ts'],
          fileParallelism: false,
          include: ['lib/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [
              { browser: 'chromium' },
              { browser: 'firefox' },
              {
                browser: 'chromium',
                name: 'browser (chromium classic scrollbars)',
                provider: playwright({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } }),
                include: ['lib/ui/overlay-layout.browser.test.ts'],
                provide: { classicScrollbars: true },
              },
            ],
          },
        },
      },
    ],
  },
});
