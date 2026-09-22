import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const commandEventStub = {
  addListener: () => {},
  removeListener: () => {},
};

function installCommandEventStub(): void {
  Object.defineProperty(fakeBrowser.commands, 'onCommand', {
    configurable: true,
    value: commandEventStub,
  });
}

const originalReset = fakeBrowser.reset.bind(fakeBrowser);
Object.defineProperty(fakeBrowser, 'reset', {
  configurable: true,
  value: () => {
    originalReset();
    installCommandEventStub();
  },
});

installCommandEventStub();
beforeEach(() => {
  installCommandEventStub();
});
