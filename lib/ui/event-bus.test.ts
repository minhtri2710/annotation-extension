import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from './event-bus';

interface UiEvents {
  toolbar: { label: string };
  panel: { open: boolean };
}

describe('event bus', () => {
  it('delivers the typed payload to every current subscriber', () => {
    const bus = createEventBus<UiEvents>();
    const received: Array<{ subscriber: string; label: string }> = [];

    bus.on('toolbar', (payload) => received.push({ subscriber: 'first', label: payload.label }));
    bus.on('toolbar', (payload) => received.push({ subscriber: 'second', label: payload.label }));

    bus.emit('toolbar', { label: 'annotate' });

    expect(received).toEqual([
      { subscriber: 'first', label: 'annotate' },
      { subscriber: 'second', label: 'annotate' },
    ]);
  });

  it('stops delivery when the unsubscribe handle is called', () => {
    const bus = createEventBus<UiEvents>();
    const received: boolean[] = [];
    const unsubscribe = bus.on('panel', (payload) => received.push(payload.open));

    bus.emit('panel', { open: true });
    unsubscribe();
    bus.emit('panel', { open: false });

    expect(received).toEqual([true]);
  });

  it('stops delivery when a subscriber is removed with off', () => {
    const bus = createEventBus<UiEvents>();
    const received: boolean[] = [];
    const subscriber = (payload: UiEvents['panel']) => received.push(payload.open);

    bus.on('panel', subscriber);
    bus.off('panel', subscriber);
    bus.emit('panel', { open: true });

    expect(received).toEqual([]);
  });

  it('ignores empty channels and keeps event channels isolated', () => {
    const bus = createEventBus<UiEvents>();
    const toolbarSubscriber = vi.fn();

    bus.on('toolbar', toolbarSubscriber);

    expect(() => bus.emit('panel', { open: true })).not.toThrow();
    expect(toolbarSubscriber).not.toHaveBeenCalled();

    bus.emit('toolbar', { label: 'used' });
    expect(toolbarSubscriber).toHaveBeenCalledWith({ label: 'used' });
  });
});
