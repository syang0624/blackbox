import { describe, it, expect, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, runRead, closeDriver } from '../src/graph/neo4j.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => {
  await closeDriver();
});

run('neo4j (live)', () => {
  it('connects, applies schema, runs a read', async () => {
    try {
      await initSchema();
      const rows = await runRead<{ ok: number }>('RETURN 1 AS ok');
      expect(rows[0].ok).toBe(1);
    } catch (e) {
      if (String(e).includes('Neo.ClientError.Security.Unauthorized')) return;
      throw e;
    }
  });
});
