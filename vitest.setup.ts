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

interface FakeEvent<Args extends unknown[]> {
  addListener(listener: (...args: Args) => void): void;
  removeListener(listener: (...args: Args) => void): void;
  emit(...args: Args): void;
  listeners: Set<(...args: Args) => void>;
}

interface FakePort {
  name: string;
  onMessage: FakeEvent<[message: unknown, port: FakePort]>;
  onDisconnect: FakeEvent<[port: FakePort]>;
  postMessage(message: unknown): void;
  disconnect(): void;
}

function createEvent<Args extends unknown[]>(): FakeEvent<Args> {
  const listeners = new Set<(...args: Args) => void>();
  return {
    listeners,
    addListener: (listener) => { listeners.add(listener); },
    removeListener: (listener) => { listeners.delete(listener); },
    emit: (...args) => { for (const listener of [...listeners]) listener(...args); },
  };
}

const importConnections = createEvent<[port: FakePort]>();

function createPort(name: string): FakePort {
  let disconnected = false;
  let caller: FakePort;
  let peer: FakePort;
  const makeEndpoint = (isCaller: boolean): FakePort => {
    const onMessage = createEvent<[message: unknown, port: FakePort]>();
    const onDisconnect = createEvent<[port: FakePort]>();
    return {
      name,
      onMessage,
      onDisconnect,
      postMessage: (message: unknown) => {
        const target = isCaller ? peer : caller;
        if (disconnected) throw new Error('Port is disconnected');
        const copy: unknown = JSON.parse(JSON.stringify(message));
        queueMicrotask(() => target.onMessage.emit(copy, target));
      },
      disconnect: () => {
        if (disconnected) return;
        disconnected = true;
        const target = isCaller ? peer : caller;
        queueMicrotask(() => target.onDisconnect.emit(target));
      },
    };
  };
  caller = makeEndpoint(true);
  peer = makeEndpoint(false);
  const listeners = [...importConnections.listeners];
  if (listeners.length === 0) {
    disconnected = true;
    queueMicrotask(() => caller.onDisconnect.emit(caller));
  } else {
    queueMicrotask(() => {
      if (!disconnected) for (const listener of listeners) listener(peer);
    });
  }
  return caller;
}

function installPortFake(): void {
  importConnections.listeners.clear();
  Object.defineProperty(fakeBrowser.runtime, 'onConnect', {
    configurable: true,
    value: importConnections,
  });
  Object.defineProperty(fakeBrowser.runtime, 'connect', {
    configurable: true,
    value: (connectInfo?: { name?: string }) => createPort(connectInfo?.name ?? ''),
  });
}

const originalReset = fakeBrowser.reset.bind(fakeBrowser);
Object.defineProperty(fakeBrowser, 'reset', {
  configurable: true,
  value: () => {
    originalReset();
    installCommandEventStub();
    installPortFake();
  },
});

installCommandEventStub();
installPortFake();
beforeEach(() => {
  installCommandEventStub();
  installPortFake();
});
