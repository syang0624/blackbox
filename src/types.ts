// ---- Frontend-contract types (must match frontend/src/types/index.ts) ----
export type SessionStatus = 'idle' | 'extracting' | 'dialing' | 'navigating' | 'on_hold' | 'handoff' | 'done';

export interface Session {
  id: string;
  user_input: string;
  detected_company: string | null;
  detected_intent: string | null;
  status: SessionStatus;
  created_at: string;
}

export type NodeType =
  | 'Person' | 'Email' | 'Booking' | 'Flight' | 'Airline'
  | 'LoyaltyAccount' | 'PaymentMethod' | 'Airport' | 'Attachment';

export interface GraphNode { id: string; label: string; type: NodeType; }
export interface GraphEdge { id: string; source: string; target: string; type: string; }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface IvrDecision { id: string; prompt_text: string; decision: string; reasoning: string; timestamp: string; }
export interface ReasoningEntry { id: string; message: string; timestamp: string; type: 'info' | 'decision' | 'extraction' | 'error'; }

export interface BriefingCard {
  company: string;
  user_intent: string;
  identity: { name: string; loyalty_program: string; loyalty_number: string };
  booking: { pnr: string; flight_number: string; route: string; date: string; status: string };
  payment: { brand: string; last4: string };
  context: { user_location: string; urgency: string };
  suggested_opening: string;
}

// ---- Backend-internal types ----
export interface MockEmail {
  id: string; from: string; to: string; subject: string; date: string; body: string; forwarded_from?: string;
}

// One email's worth of extracted entities (Asiana baggage-claim shape).
export interface ExtractedEntities {
  person?: { id?: string; name?: string; email?: string };
  booking?: { pnr?: string; airline?: string };
  flight?: { number?: string; date?: string; route?: string; from?: string; to?: string; status?: string; airline?: string };
  loyalty?: { program?: string; number?: string; airline?: string };
  payment?: { brand?: string; last4?: string };
  baggage?: { tag?: string; damage?: string };
  airports?: string[];
}

// Raw dossier from the briefing Cypher query.
export interface BriefingDossier {
  name?: string; loyalty_program?: string; loyalty_number?: string;
  pnr?: string; flight_number?: string; route?: string; date?: string; status?: string;
  payment_brand?: string; payment_last4?: string; baggage_tag?: string;
}
