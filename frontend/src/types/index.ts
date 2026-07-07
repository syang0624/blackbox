export type SessionStatus =
  | "idle"
  | "extracting"
  | "dialing"
  | "navigating"
  | "on_hold"
  | "handoff"
  | "done";

export interface Session {
  id: string;
  user_input: string;
  detected_company: string | null;
  detected_intent: string | null;
  status: SessionStatus;
  created_at: string;
}

export interface IvrDecision {
  id: string;
  prompt_text: string;
  decision: string;
  reasoning: string;
  timestamp: string;
}

export interface BriefingCard {
  company: string;
  user_intent: string;
  identity: {
    name: string;
    loyalty_program: string;
    loyalty_number: string;
  };
  booking: {
    pnr: string;
    flight_number: string;
    route: string;
    date: string;
    status: string;
  };
  payment: {
    brand: string;
    last4: string;
  };
  context: {
    user_location: string;
    urgency: string;
  };
  suggested_opening: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type:
    | "Person"
    | "Email"
    | "Booking"
    | "Flight"
    | "Airline"
    | "LoyaltyAccount"
    | "PaymentMethod"
    | "Airport"
    | "Attachment";
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ReasoningEntry {
  id: string;
  message: string;
  timestamp: string;
  type: "info" | "decision" | "extraction" | "error";
}
