import { browser } from 'wxt/browser';

void browser.devtools.panels.create(
  'Annotations',
  '',
  'devtools-panel.html',
  () => {},
);
