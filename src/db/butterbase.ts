import type { Config } from '../config.js';
import type { Db, SessionRow, IvrDecisionRow, ReasoningRow } from './interface.js';

export function createButterbaseDb(cfg: Config): Db {
  const base = `${cfg.butterbase.apiUrl}/v1/${cfg.butterbase.appId}`;
  const headers = { Authorization: `Bearer ${cfg.butterbase.apiKey}`, 'Content-Type': 'application/json' };

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Butterbase ${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
  }

  return {
    async createSession(input) {
      return req<SessionRow>('POST', '/sessions', {
        user_input: input.user_input,
        detected_company: input.detected_company ?? null,
        detected_intent: input.detected_intent ?? null,
        status: 'extracting',
      });
    },
    async getSession(id) {
      try {
        return await req<SessionRow>('GET', `/sessions/${id}`);
      } catch {
        return null;
      }
    },
    async updateSession(id, patch) {
      await req('PATCH', `/sessions/${id}`, patch);
    },
    async addIvrDecision(r) {
      return req<IvrDecisionRow>('POST', '/ivr_decisions', r);
    },
    async listIvrDecisions(sessionId) {
      return req<IvrDecisionRow[]>('GET', `/ivr_decisions?session_id=eq.${sessionId}&order=created_at.asc`);
    },
    async saveBriefingCard(sessionId, cardJson, suggestedOpening) {
      await req('POST', '/briefing_cards', {
        session_id: sessionId,
        card_json: cardJson,
        suggested_opening: suggestedOpening,
      });
    },
    async getBriefingCard(sessionId) {
      const rows = await req<{ card_json: unknown; suggested_opening: string | null }[]>(
        'GET',
        `/briefing_cards?session_id=eq.${sessionId}&order=created_at.desc&limit=1`,
      );
      return rows[0] ?? null;
    },
    async addReasoning(r) {
      return req<ReasoningRow>('POST', '/reasoning_events', r);
    },
    async listReasoning(sessionId) {
      return req<ReasoningRow[]>('GET', `/reasoning_events?session_id=eq.${sessionId}&order=created_at.asc`);
    },
  };
}
