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
    browser_specific_settings: {
      gecko: {
        id: 'annotation-extension@minhtri2710',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
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
  zip: { excludeSources: ['backlog.md', 'done-archive.md'] },
});
