"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  Session,
  SessionStatus,
  IvrDecision,
  BriefingCard,
  GraphData,
  ReasoningEntry,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface SessionState {
  session: Session | null;
  graph: GraphData;
  ivrLog: IvrDecision[];
  briefing: BriefingCard | null;
  reasoning: ReasoningEntry[];
  error: string | null;
  isConnected: boolean;
}

export function useSession(sessionId: string | null) {
  const [state, setState] = useState<SessionState>({
    session: null,
    graph: { nodes: [], edges: [] },
    ivrLog: [],
    briefing: null,
    reasoning: [],
    error: null,
    isConnected: false,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE stream for live updates
  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`${API_BASE}/sessions/${sessionId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
    };

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        session: prev.session
          ? { ...prev.session, status: data.status }
          : null,
      }));
    });

    es.addEventListener("graph", (e) => {
      const data = JSON.parse(e.data) as GraphData;
      setState((prev) => ({ ...prev, graph: data }));
    });

    es.addEventListener("ivr", (e) => {
      const decision = JSON.parse(e.data) as IvrDecision;
      setState((prev) => ({
        ...prev,
        ivrLog: [...prev.ivrLog, decision],
      }));
    });

    es.addEventListener("briefing", (e) => {
      const data = JSON.parse(e.data) as BriefingCard;
      setState((prev) => ({ ...prev, briefing: data }));
    });

    es.addEventListener("reasoning", (e) => {
      const entry = JSON.parse(e.data) as ReasoningEntry;
      setState((prev) => ({
        ...prev,
        reasoning: [...prev.reasoning, entry],
      }));
    });

    es.onerror = () => {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: "Connection lost. Retrying...",
      }));
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionId]);

  const createSession = useCallback(async (userInput: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: userInput }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const session = (await res.json()) as Session;
      setState((prev) => ({ ...prev, session, error: null }));
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({ ...prev, error: message }));
      return null;
    }
  }, []);

  return {
    ...state,
    createSession,
  };
}

// Mock hook for development without backend
export function useSessionMock(sessionId: string | null) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [ivrLog, setIvrLog] = useState<IvrDecision[]>([]);
  const [briefing, setBriefing] = useState<BriefingCard | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningEntry[]>([]);

  const mockSession: Session = {
    id: sessionId || "mock-1",
    user_input:
      "My United flight to Chicago just got canceled and I need to rebook.",
    detected_company: "United Airlines",
    detected_intent: "rebook_flight",
    status,
    created_at: new Date().toISOString(),
  };

  const runDemo = useCallback(async () => {
    // Simulate the full flow with delays
    setStatus("extracting");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r1",
        message: 'Identified company: United Airlines. Intent: rebook flight.',
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    await delay(1500);

    // Add graph nodes progressively
    const nodes: GraphData["nodes"] = [
      { id: "p1", label: "Jamie Chen", type: "Person" },
      { id: "b1", label: "ABC123", type: "Booking" },
      { id: "f1", label: "UA1234 SFO→ORD", type: "Flight" },
      { id: "a1", label: "United Airlines", type: "Airline" },
      { id: "l1", label: "MileagePlus #1234567", type: "LoyaltyAccount" },
      { id: "pm1", label: "Chase ••4242", type: "PaymentMethod" },
      { id: "ap1", label: "SFO", type: "Airport" },
      { id: "ap2", label: "ORD", type: "Airport" },
    ];

    const edges: GraphData["edges"] = [
      { id: "e1", source: "p1", target: "b1", type: "HAS_BOOKING" },
      { id: "e2", source: "b1", target: "f1", type: "INCLUDES" },
      { id: "e3", source: "f1", target: "a1", type: "OPERATED_BY" },
      { id: "e4", source: "p1", target: "l1", type: "HAS_LOYALTY" },
      { id: "e5", source: "b1", target: "pm1", type: "PAID_WITH" },
      { id: "e6", source: "f1", target: "ap1", type: "DEPARTS_FROM" },
      { id: "e7", source: "f1", target: "ap2", type: "ARRIVES_AT" },
    ];

    for (let i = 0; i < nodes.length; i++) {
      await delay(400);
      setGraph((prev) => ({
        nodes: [...prev.nodes, nodes[i]],
        edges: edges.filter(
          (edge) =>
            [...prev.nodes, nodes[i]].some((n) => n.id === edge.source) &&
            [...prev.nodes, nodes[i]].some((n) => n.id === edge.target)
        ),
      }));
      setReasoning((prev) => [
        ...prev,
        {
          id: `r-extract-${i}`,
          message: `Extracted: ${nodes[i].label} (${nodes[i].type})`,
          timestamp: new Date().toISOString(),
          type: "extraction",
        },
      ]);
    }

    await delay(800);
    setStatus("dialing");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-dial",
        message: "Dialing United Airlines customer service: 1-800-864-8331",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    await delay(2000);
    setStatus("navigating");

    const ivrSteps: IvrDecision[] = [
      {
        id: "ivr1",
        prompt_text: "Press 1 for English, 2 for Spanish",
        decision: "Press 1",
        reasoning: "User language is English",
        timestamp: new Date().toISOString(),
      },
      {
        id: "ivr2",
        prompt_text:
          "Press 1 for existing reservations, 2 for new bookings, 3 for MileagePlus",
        decision: "Press 1",
        reasoning: "User has an existing booking that was canceled",
        timestamp: new Date().toISOString(),
      },
      {
        id: "ivr3",
        prompt_text: "Press 0 to speak with an agent",
        decision: "Press 0",
        reasoning: "Need human agent for rebooking canceled flight",
        timestamp: new Date().toISOString(),
      },
      {
        id: "ivr4",
        prompt_text: "Please say your request in a few words",
        decision: 'Said: "Agent"',
        reasoning:
          "RAG policy: saying 'agent' bypasses AI screening fastest",
        timestamp: new Date().toISOString(),
      },
    ];

    for (const step of ivrSteps) {
      await delay(1800);
      setIvrLog((prev) => [...prev, step]);
      setReasoning((prev) => [
        ...prev,
        {
          id: `r-${step.id}`,
          message: `IVR: ${step.decision} — ${step.reasoning}`,
          timestamp: new Date().toISOString(),
          type: "decision",
        },
      ]);
    }

    await delay(1000);
    setStatus("on_hold");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-hold",
        message: "On hold. Assembling briefing card from graph...",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    await delay(2000);
    setBriefing({
      company: "United Airlines",
      user_intent: "Rebook canceled flight",
      identity: {
        name: "Jamie Chen",
        loyalty_program: "MileagePlus",
        loyalty_number: "1234567",
      },
      booking: {
        pnr: "ABC123",
        flight_number: "UA1234",
        route: "SFO → ORD",
        date: "2026-07-07",
        status: "canceled",
      },
      payment: {
        brand: "Chase Sapphire Preferred",
        last4: "4242",
      },
      context: {
        user_location: "SFO airport",
        urgency: "same-day rebooking needed",
      },
      suggested_opening:
        "Hi, I'm on booking ABC123, flight UA1234 from SFO to ORD today. It was canceled — I need to rebook. My MileagePlus number is 1234567 and I paid with the Chase card ending 4242.",
    });

    await delay(3000);
    setStatus("handoff");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-handoff",
        message:
          "Human agent detected: \"Thanks for calling United, this is Sarah.\"",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);
  }, []);

  const createSession = useCallback(
    async (_userInput: string) => {
      runDemo();
      return mockSession;
    },
    [runDemo]
  );

  return {
    session: sessionId ? { ...mockSession, status } : null,
    graph,
    ivrLog,
    briefing,
    reasoning,
    error: null,
    isConnected: true,
    createSession,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
