import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Annotation Extension',
    description: 'A browser extension for visual web annotation.',
    permissions: ['storage', 'activeTab', 'scripting'],
  },
});
