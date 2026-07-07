import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub, type SseEvent } from '../src/sse/hub.js';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'Asiana Airlines', intent: 'baggage_damage_claim' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'Press 5', reasoning: 'reach an agent' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'press 2 -> 5 -> 1 -> enter club -> hold') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({ DEMO_USER_ID: 'steven-yang', ingestEmail: vi.fn(async () => undefined) }));
vi.mock('../src/graph/query.js', () => ({
  getGraph: vi.fn(async () => ({ nodes: [{ id: 'Booking:XKRF2M', type: 'Booking', label: 'XKRF2M' }], edges: [] })),
  assembleBriefing: vi.fn(async () => ({
    pnr: 'XKRF2M',
    flight_number: 'OZ212',
    route: 'ICN -> SFO',
    status: 'completed',
    name: 'Steven Yang',
    loyalty_program: 'Asiana Club',
    loyalty_number: '920384712',
    payment_brand: 'American Express',
    payment_last4: '1087',
    baggage_tag: '0988-7234',
  })),
}));
vi.mock('../src/demo/inbox.js', () => ({
  MOCK_INBOX: [{ id: 'em1', from: 'asiana', to: 's', subject: 'conf XKRF2M', date: '2026-06-15', body: 'OZ212' }],
  EXPECTED_DOSSIER: {},
}));

import { runSession } from '../src/orchestrator/machine.js';

describe('runSession', () => {
  let db: ReturnType<typeof createMemoryDb>;
  let hub: ReturnType<typeof createSseHub>;
  let events: SseEvent[];

  beforeEach(() => {
    db = createMemoryDb();
    hub = createSseHub();
    events = [];
  });

  it('drives status to on_hold, emits coarse events, and does NOT emit handoff', async () => {
    const s = await db.createSession({ user_input: 'Asiana broke my suitcase, need a damage claim' });
    hub.subscribe(s.id, (e) => events.push(e));
    await runSession({ db, hub, stepMs: 0, holdMs: 0 }, s.id);

    const statuses = events.filter((e) => e.event === 'status').map((e) => (e.data as { status: string }).status);
    expect(statuses).toEqual(['dialing', 'navigating', 'on_hold']);

    const names = new Set(events.map((e) => e.event));
    expect(names).toContain('graph');
    expect(names).toContain('ivr');
    expect(names).toContain('briefing');
    expect(names).toContain('reasoning');
    expect(names.has('handoff')).toBe(false);
    expect(names.has('done')).toBe(false);
    expect([...names].some((n) => n.includes('.'))).toBe(false);

    const graphEvt = events.find((e) => e.event === 'graph');
    expect(graphEvt && (graphEvt.data as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0);

    const ivrEvt = events.find((e) => e.event === 'ivr');
    expect(ivrEvt && (ivrEvt.data as { prompt_text: string }).prompt_text).toBeTruthy();
    expect(ivrEvt && (ivrEvt.data as { timestamp: string }).timestamp).toBeTruthy();

    const brief = events.find((e) => e.event === 'briefing');
    expect(brief && (brief.data as { suggested_opening: string }).suggested_opening).toContain('OZ212');

    expect((await db.getSession(s.id))?.status).toBe('on_hold');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
