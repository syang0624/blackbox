import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { getIvrContext } from '../src/rag/query.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('rag (live)', () => {
  it('retrieves the Asiana path-to-human / baggage context', async () => {
    const ctx = await getIvrContext('How do I reach an Asiana agent to file a baggage damage claim?');
    expect(ctx.toLowerCase()).toMatch(/agent|press|baggage|5/);
  });
});
