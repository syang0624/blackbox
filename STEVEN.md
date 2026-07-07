# STEVEN — Frontend & Visualization

Work breakdown for the BlackBox frontend: UI, graph visualization, briefing card, phone UI, and demo polish.

---

## Day 1 — Setup & Core Components

### Morning — Project Scaffold

- [ ] **Project setup** — Initialize frontend app (framework TBD: Next.js / Vite + React). Set up routing, styling (Tailwind recommended), and basic layout
- [ ] **Home screen** — Single text input: _"What's going on?"_ + recent sessions list (PRD §14)
- [ ] **Layout for live call screen** — Three-panel layout: left (phone UI), center (graph), right (briefing card), bottom strip (reasoning log)

### Afternoon — Component Shells

- [ ] **Phone UI component** — Left panel. States: dialing → ringing → connected → navigating IVR → on hold → human answered. Show current IVR prompt text and key-press indicators
- [ ] **Graph visualization component** — Center panel. Use D3.js (or similar) to render Neo4j nodes and edges. Nodes: color-coded by type (Person=blue, Flight=orange, Payment=green, etc.). Should accept JSON graph data from API
- [ ] **Briefing card component** — Right panel. Renders briefing card JSON (PRD §11) field by field. Fields appear progressively as data arrives
- [ ] **Reasoning log component** — Bottom strip. Scrolling log of agent decisions with timestamps

### Evening — Polish Component Behavior

- [ ] **Connect to backend SSE/WebSocket** — Subscribe to session updates. Route events to the correct component (graph updates → graph viz, IVR decisions → phone UI, briefing fields → card)
- [ ] **Graph animation** — Nodes appear with entrance animation as extraction happens. Edges draw in. Highlight active query path during briefing assembly
- [ ] **Audio playback integration** — Play pre-recorded IVR audio in the phone UI component, synced with backend timing events

## Day 2 — Handoff Moment & Demo Polish

### Morning — The Money Shot

- [ ] **Handoff animation** — When human picks up: phone UI pulses green, briefing card slides to front/center, suggested opening line in large text (PRD §14)
- [ ] **Handoff buttons** — _"End call"_ and _"I've got it from here."_
- [ ] **Status transitions** — Smooth visual transitions between phases: extracting → dialing → navigating → on_hold → handoff
- [ ] **Hold music visualization** — While on hold, subtle animation (pulsing, waveform) so the screen doesn't look frozen

### Afternoon — Integration & Demo Readiness

- [ ] **End-to-end with Nori's backend** — Full flow test: type complaint → watch graph build → IVR plays → hold → handoff moment
- [ ] **Timing sync with recorded audio** — Ensure IVR key-press indicators and phase transitions match the pre-recorded call audio
- [ ] **Responsive tweaks for demo display** — Optimize for the projector/screen resolution being used on stage
- [ ] **Loading / error states** — Graceful handling if backend is slow or disconnects
- [ ] **Demo dry run** — Run through the full demo script (PRD §18) with Nori

---

## Key Interfaces with Nori

| What Steven needs from Nori | Format |
|---|---|
| Session creation + status polling | REST: `POST /sessions`, `GET /sessions/:id` |
| Real-time session updates | SSE or WebSocket stream |
| Graph data (nodes + edges) | JSON: `GET /sessions/:id/graph` |
| IVR decision log | JSON array: `GET /sessions/:id/ivr-log` |
| Briefing card | JSON (PRD §11 schema): `GET /sessions/:id/briefing` |
| Agent reasoning log | JSON array: `GET /sessions/:id/reasoning` |
| Audio file URL | Presigned URL from Butterbase Storage |
| Audio playback timing events | Events via SSE/WS with timestamps |

---

## Design Notes

- **Color palette:** Dark background, light text. Graph nodes color-coded by entity type. Green pulse for handoff moment
- **Typography:** Monospace for reasoning log. Clean sans-serif for briefing card. Large bold for suggested opening line
- **Motion:** Subtle and purposeful. Graph nodes fade/scale in. Briefing fields slide in. Handoff is the big animation moment — everything else stays calm
- **Demo priority:** The two "wow" moments are (1) graph assembling in real time and (2) human picking up with briefing card. Everything else is supporting

---

## Tech Decisions to Make

- [ ] Framework: Next.js vs Vite + React
- [ ] Graph library: D3.js vs vis.js vs Neo4j Bloom embed
- [ ] Styling: Tailwind vs styled-components
- [ ] State management: React context vs Zustand (keep it simple)
