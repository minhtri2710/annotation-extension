import { defineConfig } from 'wxt';

const icons = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  128: 'icon/128.png',
};

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Annotation Extension',
    description: 'A browser extension for visual web annotation.',
    icons,
    action: { default_icon: icons },
    permissions: ['storage', 'activeTab'],
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
