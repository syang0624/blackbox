# STEVEN — Backend & Agent Logic

Work breakdown for the BlackBox backend: Butterbase, Neo4j, agent pipeline, and call orchestration.

---

## Day 1 Morning — Foundation

- [ ] **Butterbase DB setup** — Create tables: `sessions`, `ivr_decisions`, `briefing_cards`, `call_artifacts` (schema in PRD §10.1)
- [ ] **Butterbase Storage setup** — Create bucket for call recordings, IVR audio snippets, boarding pass PDFs
- [ ] **Butterbase RAG setup** — Create collection for IVR maps and rebooking policies
- [ ] **Neo4j setup** — Provision instance, create schema: node labels (`Person`, `Email`, `Booking`, `Flight`, `Airline`, `LoyaltyAccount`, `PaymentMethod`, `Airport`, `Attachment`) and relationship types (PRD §7.2)
- [ ] **Mock inbox** — Write ~15 realistic email JSON fixtures (booking confirmation, Expedia itinerary, MileagePlus welcome, Chase statement, cancellation notice, decoys)
- [ ] **Record United IVR** — Call United, record the IVR tree audio in a one-party-consent state

## Day 1 Afternoon — Extraction Pipeline

- [ ] **Email entity extraction prompt** — LLM prompt that takes a raw email and outputs structured entities (person, booking, flight, loyalty, payment)
- [ ] **Entity → Neo4j ingestion** — Script/service that takes extracted entities and merges nodes + edges into the graph
- [ ] **Briefing dossier Cypher query** — Write and verify the query that returns PNR, flight number, loyalty number, payment last-4 from the graph (PRD §7.2 example)
- [ ] **End-to-end extraction test** — Seed mock inbox → extract → ingest → query → verify full dossier returned

## Day 1 Evening — RAG & Agent

- [ ] **Populate RAG corpus** — United IVR map (path to human: `1 → 2 → 0 → "agent"`), rebooking policy doc, weather cancellation policy
- [ ] **Complaint understanding agent** — Takes user input, returns `detected_company` + `detected_intent`
- [ ] **IVR navigation agent** — Given IVR prompt text + RAG context, decides which key to press / phrase to speak. Logs reasoning to `ivr_decisions` table
- [ ] **Call orchestration service** — State machine: `extracting → dialing → navigating → on_hold → handoff → done`. Updates `sessions.status`. Coordinates extraction pipeline + IVR agent + briefing card assembly
- [ ] **Briefing card assembly** — On hold, run Cypher query, format into briefing card JSON (PRD §11), write to `briefing_cards` table, generate `suggested_opening`

## Day 2 Morning — API & Integration

- [ ] **API endpoints for frontend** — Nori needs these:
  - `POST /sessions` — create session from user complaint
  - `GET /sessions/:id` — poll session status
  - `GET /sessions/:id/graph` — current Neo4j graph state (nodes + edges for visualization)
  - `GET /sessions/:id/ivr-log` — stream of IVR decisions
  - `GET /sessions/:id/briefing` — briefing card JSON
  - `GET /sessions/:id/reasoning` — agent reasoning log
- [ ] **WebSocket or SSE for live updates** — Frontend needs real-time updates for graph assembly, IVR decisions, status transitions, briefing card population
- [ ] **Wire IVR audio playback triggers** — Send timing events to frontend so phone UI syncs with pre-recorded audio

## Day 2 Afternoon — Integration & Polish

- [ ] **End-to-end run with frontend** — Full flow: complaint → extraction → dial → IVR → hold → handoff
- [ ] **Rehearse timing against recorded audio** — IVR decision events must sync with the pre-recorded call audio
- [ ] **Edge case handling** — Ensure graceful behavior if extraction is slow or graph query returns partial results
- [ ] **Record backup screen capture** — Full successful demo run as fallback

---

## Key Interfaces with Nori

| What Steven provides | What Nori consumes |
|---|---|
| Session status updates (SSE/WS) | Status bar, phase transitions |
| Neo4j graph data (nodes + edges JSON) | D3 graph visualization |
| IVR decision log entries | Phone UI key-press indicators |
| Briefing card JSON | Briefing card component |
| Agent reasoning log | Bottom strip reasoning scroll |
| Audio playback timing events | Phone UI sync with recorded audio |

---

## Tech Decisions to Make

- [ ] Butterbase AI gateway model choice (GPT-4o? Claude?)
- [ ] WebSocket vs SSE for live updates
- [ ] How to serve pre-recorded IVR audio to frontend (Storage presigned URL? Inline?)
