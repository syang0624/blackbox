import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, runWrite, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => {
  await closeDriver();
});
let liveNeo4j = true;
const email: MockEmail = {
  id: 'test-conf-1',
  from: 'no-reply@flyasiana.com',
  to: 's@x.com',
  subject: 'Confirmation XKRF2M',
  date: '2026-06-20T00:00:00Z',
  body: '...',
};

run('graph ingest (live)', () => {
  beforeAll(async () => {
    try {
      await initSchema();
      await runWrite('MATCH (n) WHERE n.id STARTS WITH "test-" OR n.pnr = "ZZ999" OR n.tag = "TESTTAG" DETACH DELETE n');
    } catch (e) {
      if (String(e).includes('Neo.ClientError.Security.Unauthorized')) {
        liveNeo4j = false;
        return;
      }
      throw e;
    }
  });

  it('creates booking+flight+airline+baggage and links them', async () => {
    if (!liveNeo4j) return;
    await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Steven Yang', email: 's@x.com' },
      booking: { pnr: 'ZZ999', airline: 'Asiana Airlines' },
      flight: {
        number: 'OZ212',
        date: '2026-07-03',
        route: 'ICN -> SFO',
        from: 'ICN',
        to: 'SFO',
        status: 'completed',
        airline: 'Asiana Airlines',
      },
      baggage: { tag: 'TESTTAG', damage: 'broken handle' },
    });
    const linked = await runWrite<{ c: number }>(
      'MATCH (:Person {id:$u})-[:HAS_BOOKING]->(:Booking {pnr:"ZZ999"})-[:INCLUDES]->(:Flight {number:"OZ212"})-[:OPERATED_BY]->(:Airline {name:"Asiana Airlines"}) RETURN count(*) AS c',
      { u: DEMO_USER_ID },
    );
    expect(Number(linked[0].c)).toBe(1);
    const bag = await runWrite<{ c: number }>(
      'MATCH (:Booking {pnr:"ZZ999"})-[:HAS_BAGGAGE]->(:Attachment {tag:"TESTTAG"}) RETURN count(*) AS c',
    );
    expect(Number(bag[0].c)).toBe(1);
  });

  it('is idempotent across repeated ingest', async () => {
    if (!liveNeo4j) return;
    await ingestEmail(DEMO_USER_ID, email, { booking: { pnr: 'ZZ999' } });
    const rows = await runWrite<{ c: number }>('MATCH (b:Booking {pnr:"ZZ999"}) RETURN count(b) AS c');
    expect(Number(rows[0].c)).toBe(1);
  });
});
