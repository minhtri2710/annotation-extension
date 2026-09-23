import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Annotation Extension',
    description: 'A browser extension for visual web annotation.',
    permissions: ['storage', 'activeTab', 'scripting'],
    browser_specific_settings: { gecko: { strict_min_version: '125.0' } },
    commands: {
      'capture.toggle': {
        suggested_key: {
          default: 'Ctrl+Shift+Period',
          mac: 'MacCtrl+Shift+Period',
        },
        description: 'Toggle annotation capture mode',
      },
    },
  },
});
