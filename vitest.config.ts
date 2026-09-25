import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

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
        test: {
          name: 'browser',
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
              // Playwright hides scrollbars by default; this instance shows classic ones for the overlay layout spec.
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
