import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { detectCompanyIntent } from '../src/ai/intent.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('ai gateway (live)', () => {
  it('detects Asiana + a baggage/claim intent from the demo complaint', async () => {
    const r = await detectCompanyIntent('Asiana broke my suitcase on my recent flight and I need to file a damage claim.');
    expect(r.company.toLowerCase()).toContain('asiana');
    expect(r.intent.toLowerCase()).toMatch(/baggage|damage|claim/);
  });
});
