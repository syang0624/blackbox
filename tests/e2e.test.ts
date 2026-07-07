import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'Asiana Airlines', intent: 'baggage_damage_claim' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'Press 5', reasoning: 'r' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'ctx') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({ DEMO_USER_ID: 'steven-yang', ingestEmail: vi.fn(async () => undefined) }));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn(async () => null) }));
vi.mock('../src/demo/inbox.js', () => ({
  MOCK_INBOX: [{ id: 'em1', from: 'a', to: 's', subject: 'XKRF2M', date: '2026-06-15', body: 'OZ212' }],
  EXPECTED_DOSSIER: {},
}));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('e2e (offline)', () => {
  it('complaint -> orchestration -> Asiana briefing available', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'Asiana broke my suitcase' } });
    const { id } = res.json();

    let card = null;
    for (let i = 0; i < 60 && !card; i++) {
      const b = await app.inject({ method: 'GET', url: `/sessions/${id}/briefing` });
      if (b.statusCode === 200) card = b.json();
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(card).toBeTruthy();
    expect(card.company).toBe('Asiana Airlines');
    expect(card.suggested_opening).toContain('OZ212');
    await app.close();
  });
});
