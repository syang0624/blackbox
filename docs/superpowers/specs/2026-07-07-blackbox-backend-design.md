# BlackBox Backend — Design Spec

**Date:** 2026-07-07
**Owner:** Nori (backend & agent logic)
**Branch:** `nori`
**Approach:** A — graph-first, thin runtime
**Timeline:** one-day hackathon (NORI.md's 2-day breakdown is a menu to cut from, not a schedule)

---

## 1. Goal

Deliver the backend for the BlackBox demo: a user types a customer-service complaint,
the system extracts their scattered identity from a mock inbox into a **Neo4j** graph,
navigates a pre-recorded United IVR, waits on hold, and — when the "human" picks up —
hands the frontend a **briefing card** assembled by a single Cypher query.

The demo has two "wow" moments the backend must make land: (1) the graph assembling
live, and (2) the human pickup with a fully populated briefing card. Both **Butterbase**
and **Neo4j** must feel load-bearing, not decorative (a stated success metric).

## 2. Scope

**In:**
- Single Fastify (TypeScript) service exposing REST + SSE for the frontend (Steven).
- Complaint → `{company, intent}` detection (LLM).
- Mock inbox (~15 emails) → LLM entity extraction → Neo4j graph ingestion.
- Single Cypher briefing query → briefing card JSON (PRD §11).
- Butterbase RAG corpus (United IVR map + rebooking/weather policy) driving IVR decisions.
- IVR agent: real LLM decisions matched to the single recorded audio branch.
- Orchestrator state machine (`extracting → dialing → navigating → on_hold → handoff → done`)
  emitting SSE events on a timeline synced to the recorded audio.
- Presigned URL for the recorded call audio (Butterbase Storage).

**Out (cut for one day):** Gmail OAuth, payment gate, multi-branch IVR, RocketRide,
real outbound dialing, boarding-pass/attachment vision extraction.

## 3. Architecture

Single Node/TS service, `PORT=4000`, three modules behind clean seams plus an orchestrator:

- **`db` adapter** — Butterbase Data API (`sessions`, `ivr_decisions`, `briefing_cards`,
  `call_artifacts`, `reasoning_events`). In-memory fallback with identical interface when
  Butterbase creds are absent/placeholder, so the service always boots.
- **`graph` module** — Neo4j driver. Owns schema/constraints, per-email entity MERGE
  (idempotent), and the briefing Cypher query.
- **`ai` module** — Butterbase AI gateway (OpenAI-compatible). Three prompt functions:
  `detectCompanyIntent`, `extractEmailEntities`, `decideIvrAction`.
- **`orchestrator`** — in-process async state machine per session; ties the modules
  together and pushes events to the SSE hub.
- **`sse` hub** — per-session event fan-out; REST snapshot endpoints mirror the same state
  so a client can render or recover at any time.

## 4. Data flow (one demo run)

1. `POST /sessions {user_input}` → `ai.detectCompanyIntent` → insert `sessions` row
   (`status='extracting'`) → return `session_id`. Orchestrator starts (async).
2. Load the ~15 mock emails. For each: `ai.extractEmailEntities` → `graph` MERGEs nodes/edges.
   Each new node/edge → SSE `graph.node` / `graph.edge` (drip-fed on a timeline = wow #1).
   Reasoning lines → `reasoning_events` + SSE `reasoning`.
3. `status='dialing'` → `status='navigating'`. Recorded-audio timeline drives IVR beats; at
   each prompt `ai.decideIvrAction(promptText, ragContext)` → write `ivr_decisions` → SSE
   `ivr.decision` + `audio.cue` (key-press indicator + audio sync).
4. `status='on_hold'` → run briefing Cypher query → assemble card JSON → write `briefing_cards`
   → emit `briefing.field` events progressively (right panel fills = build-up to wow #2).
5. `status='handoff'` at the scripted pickup → SSE `status` + `handoff`. Then `status='done'`.

## 5. API contract (consumed by Steven)

Base: `http://localhost:4000`. JSON. CORS allows `CORS_ORIGIN`.

| Method | Path | Returns |
|---|---|---|
| POST | `/sessions` | `{ session_id, detected_company, detected_intent, status }` |
| GET | `/sessions/:id` | full session row |
| GET | `/sessions/:id/graph` | `{ nodes: [...], edges: [...] }` (from Neo4j) |
| GET | `/sessions/:id/ivr-log` | `ivr_decisions[]` |
| GET | `/sessions/:id/briefing` | `{ card_json, suggested_opening }` |
| GET | `/sessions/:id/reasoning` | `reasoning_events[]` |
| GET | `/sessions/:id/audio` | `{ url }` (presigned recorded-call audio) |
| GET | `/sessions/:id/events` | **SSE stream** (see below) |

**SSE event taxonomy** (`event:` name + JSON `data:`):
- `status` — `{ status }`
- `graph.node` — `{ id, label, type, props }`
- `graph.edge` — `{ id, from, to, type }`
- `ivr.decision` — `{ prompt_text, decision, reasoning, ts }`
- `audio.cue` — `{ cue, at_ms }` (frontend syncs recorded audio playback)
- `briefing.field` — `{ path, value }` (progressive card fill; `path` e.g. `booking.pnr`)
- `reasoning` — `{ phase, message, ts }`
- `handoff` — `{ suggested_opening }`
- `done` — `{}`

Graph GET + SSE `graph.*` share the same node/edge shape so the frontend has one renderer.

## 6. Data model

### 6.1 Butterbase tables (provisioned — app `app_cyc857msb86y`, migration `blackbox_initial`)

- `sessions(id, user_id, user_input, detected_company, detected_intent, status, created_at)`
- `ivr_decisions(id, session_id→sessions, prompt_text, decision, reasoning, created_at)`
- `briefing_cards(id, session_id→sessions, card_json jsonb, suggested_opening, created_at)`
- `call_artifacts(id, session_id→sessions, artifact_type, storage_object_id, created_at)`
- `reasoning_events(id, session_id→sessions, phase, message, created_at)` — backs `/reasoning`

All child tables have a `session_id` index and `ON DELETE CASCADE`.

### 6.2 Neo4j schema (PRD §7.2)

- **Nodes:** `Person, Email, Booking, Flight, Airline, LoyaltyAccount, PaymentMethod, Airport, Attachment`
- **Edges:** `SENT_BY, MENTIONS, INCLUDES, PAID_WITH, HAS_LOYALTY, HAS_BOOKING, DEPARTS_FROM, CONNECTED_TO, FORWARDED_FROM, COMPANION_OF`
- Uniqueness constraints on natural keys (e.g. `Booking.pnr`, `Flight.number+date`,
  `LoyaltyAccount.number`, `Person.id`) so extraction MERGE is idempotent across emails.

**Briefing query** (returns the whole dossier in one traversal):
```cypher
MATCH (u:Person {id: $user})-[:HAS_BOOKING]->(b:Booking)-[:INCLUDES]->(f:Flight {status:'canceled'})
MATCH (u)-[:HAS_LOYALTY]->(l:LoyaltyAccount {airline: f.airline})
OPTIONAL MATCH (b)-[:PAID_WITH]->(p:PaymentMethod)
RETURN b.pnr, f.number, f.date, f.route, l.program, l.number, p.brand, p.last4
```
`OPTIONAL MATCH` on payment so a partial graph still yields a (partial) card.

## 7. Provisioned infrastructure (verified 2026-07-07)

- **Butterbase app:** `app_cyc857msb86y` (`blackbox`), API base `https://api.butterbase.ai`.
- **App-scoped service key** (`blackbox-backend`, scopes: app + `ai:gateway`) → `BUTTERBASE_API_KEY`.
  Note: an account-scoped key does **not** authorize a newly created app — an app-scoped key is required.
- **AI model:** `openai/gpt-4o-mini` (provider-prefixed IDs required).
- **Storage:** app-scoped (no named buckets); recorded audio stored as an object, referenced
  by `objectId` in `RECORDED_CALL_AUDIO_OBJECT_ID`, presigned per request.
- **RAG collection:** `support-knowledge` (shared access) — to be populated with the United
  IVR map and rebooking/weather policy.
- **Verified:** Data API read/write/delete, app-scoped AI chat, Neo4j reachability.
- **Blocked:** Neo4j auth (password rejected — user to supply correct AuraDB password).

## 8. Error handling & demo safety

- Every external call (Neo4j, Butterbase, LLM) wrapped with a timeout + fallback.
- Missing/invalid Butterbase creds → in-memory `db` adapter; service still boots and demos.
- Partial extraction → briefing query uses `OPTIONAL MATCH`; card renders partial (PRD edge case).
- **Seeded fallback:** if live extraction fails, a pre-baked graph + briefing for the United
  scenario loads so the demo never hard-fails (mirrors PRD §12 backup philosophy).
- IVR decisions are matched to the single recorded branch; a mismatch falls back to the
  known-correct next step so audio and UI never desync.

## 9. Testing

- **Unit:** `extractEmailEntities` fixtures → expected entities; briefing Cypher returns the
  full dossier from a seeded graph (the NORI.md "end-to-end extraction test").
- **Integration:** `POST /sessions` → drive orchestrator → assert the SSE event sequence and
  final briefing card match the demo script (PRD §9 / §18).
- **Smoke:** startup script pings Butterbase Data API + AI + Neo4j `RETURN 1`.

## 10. Open items (not blockers to building)

- Neo4j password (user).
- Recorded United IVR audio asset + its Storage `objectId` (team / recording task).
- Final mock-inbox content (~15 emails incl. decoys) — authored as fixtures during the build.
- Exact demo timeline durations — tuned against the real recording during rehearsal.
