export type EventHandler<Payload> = (payload: Payload) => void;

export interface EventBus<Events extends object> {
  on<Event extends keyof Events>(event: Event, handler: EventHandler<Events[Event]>): () => void;
  off<Event extends keyof Events>(event: Event, handler: EventHandler<Events[Event]>): void;
  emit<Event extends keyof Events>(event: Event, payload: Events[Event]): void;
}

export function createEventBus<Events extends object>(): EventBus<Events> {
  const subscribers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  return {
    on(event, handler) {
      let eventSubscribers = subscribers.get(event);
      if (!eventSubscribers) {
        eventSubscribers = new Set();
        subscribers.set(event, eventSubscribers);
      }

      const subscriber = handler as EventHandler<unknown>;
      eventSubscribers.add(subscriber);
      return () => {
        const currentSubscribers = subscribers.get(event);
        currentSubscribers?.delete(subscriber);
        if (currentSubscribers?.size === 0) subscribers.delete(event);
      };
    },

    off(event, handler) {
      subscribers.get(event)?.delete(handler as EventHandler<unknown>);
    },

    emit(event, payload) {
      const eventSubscribers = subscribers.get(event);
      if (!eventSubscribers) return;

      for (const handler of [...eventSubscribers]) {
        handler(payload);
      }
    },
  };
}
