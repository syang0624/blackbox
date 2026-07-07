import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/orchestrator/machine.js', () => ({
  runSession: vi.fn(async (deps: { hub: { publish: (s: string, e: string, d: unknown) => void } }, id: string) => {
    deps.hub.publish(id, 'status', { status: 'on_hold' });
  }),
}));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn() }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('routes', () => {
  it('POST /sessions returns the full Session (with id, not session_id)', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'asiana suitcase' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.session_id).toBeUndefined();
    expect(body.status).toBe('extracting');
    expect(body.user_input).toBe('asiana suitcase');
    await app.close();
  });

  it('GET /sessions/:id returns the row; 404 for unknown', async () => {
    const db = createMemoryDb();
    const app = buildServer({ db, hub: createSseHub() });
    const s = await db.createSession({ user_input: 'x' });
    expect((await app.inject({ method: 'GET', url: `/sessions/${s.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/sessions/nope' })).statusCode).toBe(404);
    await app.close();
  });

  it('GET /sessions/:id/briefing 404s before assembly', async () => {
    const db = createMemoryDb();
    const app = buildServer({ db, hub: createSseHub() });
    const s = await db.createSession({ user_input: 'x' });
    expect((await app.inject({ method: 'GET', url: `/sessions/${s.id}/briefing` })).statusCode).toBe(404);
    await app.close();
  });
});
