import { describe, it, expect, vi } from 'vitest';
import { createSseHub } from '../src/sse/hub.js';

describe('sse hub', () => {
  it('delivers published events to subscribers of the same session', () => {
    const hub = createSseHub();
    const a = vi.fn();
    hub.subscribe('s1', a);
    hub.publish('s1', 'status', { status: 'dialing' });
    expect(a).toHaveBeenCalledWith({ event: 'status', data: { status: 'dialing' } });
  });

  it('does not deliver across sessions', () => {
    const hub = createSseHub();
    const a = vi.fn();
    hub.subscribe('s1', a);
    hub.publish('s2', 'status', {});
    expect(a).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const hub = createSseHub();
    const a = vi.fn();
    const off = hub.subscribe('s1', a);
    off();
    hub.publish('s1', 'status', {});
    expect(a).not.toHaveBeenCalled();
  });

  it('buffers events for replay to late subscribers', () => {
    const hub = createSseHub();
    hub.publish('s1', 'graph', { nodes: [], edges: [] });
    expect(hub.replayBuffer('s1')).toEqual([{ event: 'graph', data: { nodes: [], edges: [] } }]);
  });
});
