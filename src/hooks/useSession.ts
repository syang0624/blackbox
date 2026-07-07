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

    let cancelled = false;
    fetch(`${API_BASE}/sessions/${sessionId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((session: Session | null) => {
        if (!cancelled && session) {
          setState((prev) => ({ ...prev, session, error: null }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, error: "Session not found" }));
        }
      });

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
      cancelled = true;
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
  const [audioPlaying, setAudioPlaying] = useState(false);
  const hasStartedRef = useRef(false);

  const mockSession: Session = {
    id: sessionId || "mock-1",
    user_input:
      "Asiana broke my suitcase on my recent flight and I need to file a damage claim.",
    detected_company: "Asiana Airlines",
    detected_intent: "baggage_damage_claim",
    status,
    created_at: new Date().toISOString(),
  };

  const runDemo = useCallback(async () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    setStatus("extracting");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r1",
        message: "Identified company: Asiana Airlines. Intent: baggage damage claim.",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    await delay(1500);

    // Add graph nodes progressively
    const nodes: GraphData["nodes"] = [
      { id: "p1", label: "Steven Yang", type: "Person" },
      { id: "b1", label: "XKRF2M", type: "Booking" },
      { id: "f1", label: "OZ212 ICN→SFO", type: "Flight" },
      { id: "a1", label: "Asiana Airlines", type: "Airline" },
      { id: "l1", label: "Asiana Club #920384712", type: "LoyaltyAccount" },
      { id: "pm1", label: "Amex ••1087", type: "PaymentMethod" },
      { id: "ap1", label: "ICN", type: "Airport" },
      { id: "ap2", label: "SFO", type: "Airport" },
      { id: "att1", label: "Baggage Tag #0988-7234", type: "Attachment" },
    ];

    const edges: GraphData["edges"] = [
      { id: "e1", source: "p1", target: "b1", type: "HAS_BOOKING" },
      { id: "e2", source: "b1", target: "f1", type: "INCLUDES" },
      { id: "e3", source: "f1", target: "a1", type: "OPERATED_BY" },
      { id: "e4", source: "p1", target: "l1", type: "HAS_LOYALTY" },
      { id: "e5", source: "b1", target: "pm1", type: "PAID_WITH" },
      { id: "e6", source: "f1", target: "ap1", type: "DEPARTS_FROM" },
      { id: "e7", source: "f1", target: "ap2", type: "ARRIVES_AT" },
      { id: "e8", source: "b1", target: "att1", type: "HAS_BAGGAGE" },
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

    // Briefing card assembles as soon as graph extraction completes
    setBriefing({
      company: "Asiana Airlines",
      user_intent: "File baggage damage claim",
      identity: {
        name: "Steven Yang",
        loyalty_program: "Asiana Club",
        loyalty_number: "920384712",
      },
      booking: {
        pnr: "XKRF2M",
        flight_number: "OZ212",
        route: "ICN → SFO",
        date: "2026-07-03",
        status: "completed",
      },
      payment: {
        brand: "American Express",
        last4: "1087",
      },
      context: {
        user_location: "San Francisco",
        urgency: "Suitcase broken on arrival — need damage claim filed within 7 days",
      },
      suggested_opening:
        "Hi, I flew on Asiana flight OZ212 from Seoul Incheon to San Francisco on July 3rd, booking reference XKRF2M. My checked suitcase was damaged during the flight — the handle is broken and there's a crack along the shell. My baggage tag number is 0988-7234. I need to file a damage claim. My Asiana Club number is 920384712.",
    });
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-briefing",
        message: "Briefing card assembled from graph data.",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    await delay(800);
    setStatus("dialing");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-dial",
        message: "Dialing Asiana Airlines customer service: 1-800-227-4262",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    // Start playing pre-recorded Asiana phone call audio
    setAudioPlaying(true);

    // IVR steps timed to match the pre-recorded Asiana phone call audio.
    // AI reacts AFTER each prompt finishes speaking.
    // Absolute times: 0:08, 0:24, 0:44, 1:04, 1:35

    const addIvrStep = (step: IvrDecision) => {
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
    };

    // Audio 0:00–0:04: ringing / intro
    await delay(4000);
    setStatus("navigating");

    // Audio 0:04–0:07: "For assistance in English, please press number 2."
    // AI waits for sentence to finish, then presses at 0:08
    await delay(4000);
    addIvrStep({
      id: "ivr1",
      prompt_text: "For assistance in English, please press number 2.",
      decision: "Press 2",
      reasoning: "User language is English",
      timestamp: new Date().toISOString(),
    });

    // Audio 0:10–0:22: full main menu plays through all 5 options
    // AI waits for all options, then presses 5 at 0:24
    await delay(16000);
    addIvrStep({
      id: "ivr2",
      prompt_text:
        "For arrival and departure info press 1, flight schedule press 2, Asiana Club press 3, reservation and ticketing press 4, to speak to an agent press 5.",
      decision: "Press 5",
      reasoning: "Need to speak to a human agent for baggage damage claim — not covered by self-service options",
      timestamp: new Date().toISOString(),
    });

    // Audio 0:25–0:42: full sub-menu plays through all 6 options, "all other inquiries press 6" at 0:42
    // AI waits for all options, then presses 6 at 0:44
    await delay(20000);
    addIvrStep({
      id: "ivr3",
      prompt_text:
        "For U.S. departures or arrival baggage info press 1, seat assignment press 2, unaccompanied minor or pets press 3, contact numbers press 4, internet support press 5, all other inquiries press 6.",
      decision: "Press 6",
      reasoning: "Baggage damage claim is not a standard option — route through 'all other inquiries' to reach a representative",
      timestamp: new Date().toISOString(),
    });

    // Audio 0:46–1:02: disclaimers, then "enter your membership number... if not a member press pound" finishes at 1:02
    // AI enters membership at 1:04
    await delay(20000);
    addIvrStep({
      id: "ivr4",
      prompt_text: "Please enter your Asiana Club membership number, followed by the star sign. If you are not a member, please press the pound key.",
      decision: "Entered 920384712*",
      reasoning: "Entering Asiana Club membership number from graph to authenticate and expedite service",
      timestamp: new Date().toISOString(),
    });

    // Audio 1:07–1:34: disclaimers + "estimated wait time is more than 5 minutes" finishes at 1:34
    // Show at 1:35
    await delay(31000);
    addIvrStep({
      id: "ivr5",
      prompt_text: "Due to the heavy volume of incoming calls, the estimated wait time is more than 5 minutes.",
      decision: "Holding",
      reasoning: "Connected to queue — waiting for human agent.",
      timestamp: new Date().toISOString(),
    });

    await delay(2000);
    setStatus("on_hold");
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-hold",
        message: "Waiting for human agent...",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ]);

    // Handoff is triggered externally when the audio ends — not on a timer.
  }, []);

  const triggerHandoff = useCallback(() => {
    setStatus("handoff");
    setAudioPlaying(false);
    setReasoning((prev) => [
      ...prev,
      {
        id: "r-handoff",
        message:
          "Human agent detected. Briefing card ready — handing off to user.",
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
    audioPlaying,
    error: null,
    isConnected: true,
    createSession,
    triggerHandoff,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
