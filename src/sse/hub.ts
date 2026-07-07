export interface SseEvent {
  event: string;
  data: unknown;
}

type Listener = (e: SseEvent) => void;

export interface SseHub {
  subscribe(sessionId: string, listener: Listener): () => void;
  publish(sessionId: string, event: string, data: unknown): void;
  replayBuffer(sessionId: string): SseEvent[];
}

export function createSseHub(): SseHub {
  const listeners = new Map<string, Set<Listener>>();
  const buffers = new Map<string, SseEvent[]>();

  return {
    subscribe(sessionId, listener) {
      const set = listeners.get(sessionId) ?? new Set();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => set.delete(listener);
    },
    publish(sessionId, event, data) {
      const e: SseEvent = { event, data };
      const buf = buffers.get(sessionId) ?? [];
      buf.push(e);
      buffers.set(sessionId, buf);
      for (const l of listeners.get(sessionId) ?? []) l(e);
    },
    replayBuffer(sessionId) {
      return buffers.get(sessionId) ?? [];
    },
  };
}
