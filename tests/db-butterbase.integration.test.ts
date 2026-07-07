import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { createButterbaseDb } from '../src/db/butterbase.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('butterbase db (live)', () => {
  it('round-trips a session and appends children', async () => {
    const db = createButterbaseDb(config);
    const s = await db.createSession({ user_input: 'integration test', detected_company: 'Asiana Airlines' });
    expect(s.id).toBeTruthy();
    await db.updateSession(s.id, { status: 'on_hold' });
    expect((await db.getSession(s.id))?.status).toBe('on_hold');
    await db.addReasoning({ session_id: s.id, phase: 'info', message: 'hello' });
    expect((await db.listReasoning(s.id)).length).toBeGreaterThanOrEqual(1);
    await db.saveBriefingCard(s.id, { company: 'Asiana Airlines' }, 'Hi');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
