import { randomUUID } from 'node:crypto';
import type { Db, SessionRow, IvrDecisionRow, ReasoningRow } from './interface.js';

export function createMemoryDb(): Db {
  const sessions = new Map<string, SessionRow>();
  const ivr = new Map<string, IvrDecisionRow[]>();
  const reasoning = new Map<string, ReasoningRow[]>();
  const briefings = new Map<string, { card_json: unknown; suggested_opening: string | null }>();

  return {
    async createSession(input) {
      const row: SessionRow = {
        id: randomUUID(), user_input: input.user_input,
        detected_company: input.detected_company ?? null,
        detected_intent: input.detected_intent ?? null,
        status: 'extracting', created_at: new Date().toISOString(),
      };
      sessions.set(row.id, row);
      return row;
    },
    async getSession(id) { return sessions.get(id) ?? null; },
    async updateSession(id, patch) {
      const cur = sessions.get(id);
      if (cur) sessions.set(id, { ...cur, ...patch });
    },
    async addIvrDecision(r) {
      const row: IvrDecisionRow = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
      const list = ivr.get(r.session_id) ?? [];
      list.push(row); ivr.set(r.session_id, list);
      return row;
    },
    async listIvrDecisions(sessionId) { return ivr.get(sessionId) ?? []; },
    async saveBriefingCard(sessionId, cardJson, suggestedOpening) {
      briefings.set(sessionId, { card_json: cardJson, suggested_opening: suggestedOpening });
    },
    async getBriefingCard(sessionId) { return briefings.get(sessionId) ?? null; },
    async addReasoning(r) {
      const row: ReasoningRow = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
      const list = reasoning.get(r.session_id) ?? [];
      list.push(row); reasoning.set(r.session_id, list);
      return row;
    },
    async listReasoning(sessionId) { return reasoning.get(sessionId) ?? []; },
  };
}
