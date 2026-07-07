import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../src/db/memory.js';

describe('memory db', () => {
  it('creates and reads a session with defaults', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'help' });
    expect(s.id).toBeTruthy();
    expect(s.status).toBe('extracting');
    expect((await db.getSession(s.id))?.user_input).toBe('help');
  });

  it('updates status and detected fields', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.updateSession(s.id, { status: 'on_hold', detected_company: 'Asiana Airlines' });
    const got = await db.getSession(s.id);
    expect(got?.status).toBe('on_hold');
    expect(got?.detected_company).toBe('Asiana Airlines');
  });

  it('appends and lists ivr decisions and reasoning', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.addIvrDecision({ session_id: s.id, prompt_text: 'For English press 2', decision: 'Press 2', reasoning: 'english' });
    await db.addReasoning({ session_id: s.id, phase: 'extraction', message: 'found booking' });
    expect(await db.listIvrDecisions(s.id)).toHaveLength(1);
    expect(await db.listReasoning(s.id)).toHaveLength(1);
  });

  it('stores and returns a briefing card', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.saveBriefingCard(s.id, { company: 'Asiana Airlines' }, 'Hi, I flew OZ212');
    const card = await db.getBriefingCard(s.id);
    expect((card?.card_json as { company: string }).company).toBe('Asiana Airlines');
    expect(card?.suggested_opening).toBe('Hi, I flew OZ212');
  });
});
