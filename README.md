# BlackBox

BlackBox is a hackathon demo app for automating a customer-service call. A user enters a complaint, the backend extracts identity and trip details from a mock inbox, builds a Neo4j-style graph, navigates a recorded IVR flow, and streams a live briefing card to the frontend over SSE.

Current demo scenario: **Asiana Airlines baggage damage claim** for Steven Yang, flight `OZ212` from `ICN` to `SFO`, booking `XKRF2M`, baggage tag `#0988-7234`.

## Stack

- TypeScript, Fastify, SSE
- Next.js frontend
- RocketRide extraction pipeline at `src/extraction/extraction.pipe`
- Butterbase Data API, RAG, storage, and OpenAI-compatible AI gateway
- Neo4j graph module, with in-memory fallback when Neo4j is unavailable
- Vitest test suite

## Setup

Install dependencies:

```bash
npm install
```

Create local environment config:

```bash
cp .env.example .env
```

Fill `.env` with real credentials. Do not commit `.env`.

Minimum useful values:

```bash
PORT=8000
CORS_ORIGIN=http://localhost:3000

BUTTERBASE_API_URL=https://api.butterbase.ai
BUTTERBASE_APP_ID=app_...
BUTTERBASE_API_KEY=bb_sk_...
BUTTERBASE_BASE_URL=https://api.butterbase.ai/v1
BUTTERBASE_MODEL=anthropic/claude-sonnet-4.5
BUTTERBASE_RAG_COLLECTION=support-knowledge

ROCKETRIDE_URI=https://api.rocketride.ai
ROCKETRIDE_APIKEY=...
```

Optional but recommended:

```bash
NEO4J_URI=neo4j+s://...
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=...
NEO4J_DATABASE=neo4j
```

If RocketRide is run directly from the VS Code visual editor, also add these to `.env` or to RocketRide Cloud/team secrets:

```bash
ROCKETRIDE_BUTTERBASE_API_KEY=<same value as BUTTERBASE_API_KEY>
ROCKETRIDE_BUTTERBASE_BASE_URL=https://api.butterbase.ai/v1
ROCKETRIDE_BUTTERBASE_MODEL=anthropic/claude-sonnet-4.5
```

The backend maps these automatically when it starts the pipeline, but the visual editor does not run that backend mapping.

## Run

Backend only:

```bash
npm run dev
```

Frontend only:

```bash
npm run dev:frontend
```

Production-style backend start:

```bash
npm start
```

The backend listens on `http://localhost:8000` when `PORT=8000`.

## RocketRide

`npm run dev` starts `src/server.ts`. During startup, the backend checks `ROCKETRIDE_APIKEY`; if it is configured, it automatically starts the RocketRide pipeline:

```text
src/extraction/extraction.pipe
```

You do not need to manually run the pipeline from the RocketRide VS Code editor for the app flow.

If RocketRide fails to start, the backend stays up and falls back to Butterbase extraction. This is intentional so the demo can still run.

## Seed RAG

Seed Butterbase RAG once after credentials are configured:

```bash
npm run seed:rag
```

## API

Base URL:

```text
http://localhost:8000
```

Create a session:

```http
POST /sessions
Content-Type: application/json

{ "user_input": "Asiana damaged my suitcase on flight OZ212." }
```

Response shape:

```json
{
  "id": "session-id",
  "user_input": "Asiana damaged my suitcase on flight OZ212.",
  "detected_company": "Asiana Airlines",
  "detected_intent": "baggage_damage_claim",
  "status": "extracting",
  "created_at": "2026-07-07T..."
}
```

Stream session updates:

```http
GET /sessions/:id/stream
```

SSE events:

- `status` with `{ "status": "extracting" | "dialing" | "navigating" | "on_hold" }`
- `graph` with cumulative `{ "nodes": [], "edges": [] }`
- `ivr` with one IVR decision object
- `briefing` with the full briefing card
- `reasoning` with one reasoning entry

Snapshot endpoints:

- `GET /sessions/:id`
- `GET /sessions/:id/graph`
- `GET /sessions/:id/ivr-log`
- `GET /sessions/:id/reasoning`
- `GET /sessions/:id/briefing`
- `GET /sessions/:id/audio`

The frontend owns the final handoff when recorded audio ends; the backend stops at `on_hold` after emitting the briefing.

## Tests

Run the suite:

```bash
npm test
```

Typecheck backend:

```bash
npm run typecheck
```

Typecheck frontend:

```bash
npm run typecheck:frontend
```

Integration tests self-skip when credentials are missing or invalid. Unit tests should always run.

## Local Files

Commit source, tests, docs, and lockfiles. Do not commit:

- `.env`
- `node_modules/`
- `.next/`
- `.rocketride/`
- generated `.superpowers/sdd/*` review files

## Useful Paths

- Backend entrypoint: `src/server.ts`
- Session routes and SSE contract: `src/routes/sessions.ts`
- RocketRide wrapper: `src/extraction/rocketride.ts`
- RocketRide pipeline: `src/extraction/extraction.pipe`
- Butterbase AI gateway calls: `src/ai/`
- Graph ingestion/query: `src/graph/`
- Demo inbox fixtures: `src/demo/`
- Design spec: `docs/superpowers/specs/2026-07-07-blackbox-backend-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-07-blackbox-backend.md`
