# BlackBox Backend

AI-concierge backend: complaint -> Neo4j identity graph -> briefing card, streamed live over SSE.
Demo scenario: **Asiana baggage damage claim** (matches `frontend/` + `asiana_phone_call.m4a`).
See `docs/superpowers/specs/2026-07-07-blackbox-backend-design.md`.

## Run

1. `npm install`
2. Fill `.env` (copy from `.env.example`). Neo4j password + Butterbase key give the full path; the service still boots without them (in-memory + fallbacks).
3. `npm run seed:rag` (once, populates the Asiana RAG corpus)
4. `npm start` -> http://localhost:8000

## Frontend contract

- `POST /sessions` `{user_input}` -> full `Session` `{id, user_input, detected_company, detected_intent, status, created_at}`
- `GET /sessions/:id/stream` - SSE events: `status`, `graph`, `ivr`, `briefing`, `reasoning` (handoff is fired by the frontend when the audio ends)
- Recovery snapshots: `GET /sessions/:id` - `/graph` - `/ivr-log` - `/reasoning` - `/briefing` - `/audio`

## Test

`npm test` - unit tests always run; integration tests self-skip when their creds are absent.
