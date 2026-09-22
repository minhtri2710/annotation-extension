import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Annotation Extension',
    description: 'A browser extension for visual web annotation.',
    permissions: ['storage', 'activeTab', 'scripting'],
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
