import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import { getGraph, assembleBriefing } from '../src/graph/query.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => {
  await closeDriver();
});
const email: MockEmail = { id: 'test-q-1', from: 'x', to: 'y', subject: 's', date: '2026-06-20T00:00:00Z', body: '' };

run('graph query (live)', () => {
  beforeAll(async () => {
    await initSchema();
    await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Steven Yang' },
      booking: { pnr: 'XKRF2M', airline: 'Asiana Airlines' },
      flight: {
        number: 'OZ212',
        date: '2026-07-03',
        route: 'ICN -> SFO',
        from: 'ICN',
        to: 'SFO',
        status: 'completed',
        airline: 'Asiana Airlines',
      },
      loyalty: { program: 'Asiana Club', number: '920384712', airline: 'Asiana Airlines' },
      payment: { brand: 'American Express', last4: '1087' },
      baggage: { tag: '0988-7234', damage: 'broken handle' },
    });
  });

  it('assembles the full dossier in one query', async () => {
    const d = await assembleBriefing(DEMO_USER_ID);
    expect(d?.pnr).toBe('XKRF2M');
    expect(d?.flight_number).toBe('OZ212');
    expect(d?.loyalty_number).toBe('920384712');
    expect(d?.payment_last4).toBe('1087');
    expect(d?.baggage_tag).toBe('0988-7234');
  });

  it('returns nodes/edges with source/target for visualization', async () => {
    const g = await getGraph();
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.edges[0]).toHaveProperty('source');
    expect(g.edges[0]).toHaveProperty('target');
  });
});
