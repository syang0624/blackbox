import type { Session, SessionStatus } from '../types.js';

export type SessionRow = Session;

export interface IvrDecisionRow {
  id: string; session_id: string; prompt_text: string | null;
  decision: string | null; reasoning: string | null; created_at: string;
}
export interface BriefingRow {
  id: string; session_id: string; card_json: unknown;
  suggested_opening: string | null; created_at: string;
}
export interface ReasoningRow {
  id: string; session_id: string; phase: string | null;   // phase stores ReasoningEntry.type
  message: string | null; created_at: string;
}

export interface Db {
  createSession(input: { user_input: string; detected_company?: string; detected_intent?: string }): Promise<SessionRow>;
  getSession(id: string): Promise<SessionRow | null>;
  updateSession(id: string, patch: Partial<Pick<SessionRow, 'status' | 'detected_company' | 'detected_intent'>>): Promise<void>;
  addIvrDecision(r: { session_id: string; prompt_text: string; decision: string; reasoning: string }): Promise<IvrDecisionRow>;
  listIvrDecisions(sessionId: string): Promise<IvrDecisionRow[]>;
  saveBriefingCard(sessionId: string, cardJson: unknown, suggestedOpening: string): Promise<void>;
  getBriefingCard(sessionId: string): Promise<{ card_json: unknown; suggested_opening: string | null } | null>;
  addReasoning(r: { session_id: string; phase: string; message: string }): Promise<ReasoningRow>;
  listReasoning(sessionId: string): Promise<ReasoningRow[]>;
}
