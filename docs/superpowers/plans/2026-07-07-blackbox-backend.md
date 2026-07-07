# BlackBox Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BlackBox backend — a Fastify/TypeScript service that turns a user complaint into a live-assembled Neo4j identity graph and a briefing card, streaming every step to the already-built frontend over SSE.

**Architecture:** Single Node/TS service on `PORT=8000`. Four modules behind clean seams (`db` = Butterbase Data API with in-memory fallback, `graph` = Neo4j, `extraction` = RocketRide pipeline with Butterbase-AI fallback, `ai` = Butterbase AI gateway) plus an in-process orchestrator state machine that drives a demo timeline and fans events out through an SSE hub. The **frontend is already built** (`frontend/`), so its contract is authoritative and this backend conforms to it exactly.

**Scenario (authoritative — from the built frontend + `asiana_phone_call.m4a`):** Steven Yang's checked suitcase was damaged on **Asiana** flight **OZ212 ICN→SFO** (completed 2026-07-03). He needs to file a **baggage damage claim**. Booking **XKRF2M**, **Asiana Club #920384712**, **Amex ••1087**, baggage tag **#0988-7234**.

**Tech Stack:** TypeScript (ESM, Node 20+), Fastify, `neo4j-driver`, `rocketride` SDK, native `fetch` for Butterbase, `vitest` for tests, `tsx` to run.

## Global Constraints

- Language/runtime: **TypeScript, ESM** (`"type": "module"`), **Node 20+**.
- **Frontend contract is authoritative** (`frontend/src/hooks/useSession.ts`, `frontend/src/types/index.ts`). The backend MUST match it exactly:
  - Base URL `http://localhost:8000` (`PORT=8000`), CORS allows `http://localhost:3000`.
  - `POST /sessions` body `{ user_input }` → returns the **full `Session`** object `{ id, user_input, detected_company, detected_intent, status, created_at }` (field is `id`, NOT `session_id`).
  - SSE endpoint is `GET /sessions/:id/stream` (NOT `/events`).
  - SSE event names are **coarse**, each carrying a full object: `status` `{status}` · `graph` `{nodes,edges}` (whole cumulative graph each emit) · `ivr` (one full `IvrDecision`, appended) · `briefing` (whole `BriefingCard`) · `reasoning` (one full `ReasoningEntry`, appended). No dotted sub-events, no `audio.cue`/`done`.
  - `GraphNode` = `{ id, label, type }` (type ∈ Person|Email|Booking|Flight|Airline|LoyaltyAccount|PaymentMethod|Airport|Attachment). `GraphEdge` = `{ id, source, target, type }` — **`source`/`target`**, not from/to.
  - `IvrDecision` = `{ id, prompt_text, decision, reasoning, timestamp }`. `ReasoningEntry` = `{ id, message, timestamp, type }` (type ∈ info|decision|extraction|error). `SessionStatus` ∈ idle|extracting|dialing|navigating|on_hold|handoff|done.
  - `BriefingCard` shape per `frontend/src/types/index.ts` (identity/booking/payment/context + suggested_opening).
- **Handoff is owned by the frontend** (it fires when the recorded audio ends). The backend advances through `on_hold`, emits the `briefing`, and STOPS. It does NOT emit `handoff`/`done`.
- Butterbase base URL `https://api.butterbase.ai`, app id `app_cyc857msb86y`, one app-scoped key in `BUTTERBASE_API_KEY` authenticates Data API **and** AI gateway.
- Butterbase AI model IDs are **provider-prefixed**: default LLM to `anthropic/claude-sonnet-4.5` via `BUTTERBASE_MODEL` (verified valid in the catalog; `claude-3.5-sonnet` is NOT a valid id here).
- RocketRide LLM calls use RocketRide's OpenAI-compatible API component (`llm_openai_api`) pointed at the Butterbase gateway via `BUTTERBASE_API_KEY`, `BUTTERBASE_BASE_URL`, `BUTTERBASE_MODEL`. Because `.pipe` substitution only accepts `${ROCKETRIDE_*}`, `rocketride.ts` maps those public env vars into internal `ROCKETRIDE_BUTTERBASE_*` process env vars immediately before `client.use()`. Do NOT require `ROCKETRIDE_OPENAI_KEY` or a direct OpenAI endpoint.
- Butterbase Data API paths: `GET/POST /v1/{app_id}/{table}`, `PATCH/DELETE /v1/{app_id}/{table}/{id}`, filter `col=eq.value`, `order=col.desc`. Auth `Authorization: Bearer {key}`.
- Butterbase AI path: `POST /v1/{app_id}/chat/completions` (OpenAI-compatible).
- RocketRide: `.pipe` extension; `project_id` literal GUID; `components` first; only `${ROCKETRIDE_*}` substituted; start once (`useExisting: true`), reuse token; never block the event loop; `chat` source → `client.chat()`.
- Payment methods: store/display **only brand + last4**. Never extract or store a full PAN.
- Config from `.env` (present, git-ignored). Never commit secrets.
- Every external call (Neo4j, Butterbase, RocketRide, LLM) wrapped with a timeout + fallback; the service boots and demos even if a dependency is down.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
src/
  config.ts                 # load + validate env, typed config
  types.ts                  # shared domain types (match frontend contract)
  logger.ts                 # tiny leveled logger
  db/
    interface.ts            # Db interface + row types
    memory.ts               # in-memory Db (fallback + tests)
    butterbase.ts           # Butterbase Data API Db
    index.ts                # createDb() selector
  sse/
    hub.ts                  # per-session pub/sub
  graph/
    neo4j.ts                # driver singleton + initSchema()
    ingest.ts               # ingestEmail(): MERGE entities
    query.ts                # getGraph(), assembleBriefing()
  ai/
    gateway.ts              # chatJson(): Butterbase AI call → parsed JSON
    intent.ts               # detectCompanyIntent()
    ivr.ts                  # decideIvrAction()
    extract.ts              # extractWithButterbase() (fallback)
  extraction/
    extraction.pipe         # RocketRide pipeline (llm_openai_api → Butterbase)
    rocketride.ts           # RocketRide client wrapper
    index.ts                # extractEmailEntities() with fallback
  rag/
    query.ts                # getIvrContext() via Butterbase rag_query REST
  briefing/
    assemble.ts             # dossier → BriefingCard (pure)
  orchestrator/
    timeline.ts             # demo timeline + Asiana IVR script
    machine.ts              # runSession(): the state machine
  demo/
    inbox.ts                # ~15 Asiana mock email fixtures
    fallback.ts             # pre-baked Asiana graph + briefing (demo safety)
  routes/
    sessions.ts            # REST + SSE endpoints (frontend contract)
  server.ts                 # Fastify app + startup wiring
  seed/
    seed-rag.ts             # one-off: populate RAG collection
tests/
  *.test.ts
```

---

### Task 1: Project scaffold + typed config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/logger.ts`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `parseConfig(env): Config` with `config.butterbase = { apiUrl, appId, apiKey, llmBaseUrl, model, ragCollection, configured }`, `config.neo4j`, `config.rocketride`, `config.port` (default **8000**), `config.corsOrigin`, `config.recordedAudioObjectId`, `config.flags`.
- Produces: `logger` with `.info/.warn/.error(msg, meta?)`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "blackbox-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "seed:rag": "tsx src/seed/seed-rag.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "neo4j-driver": "^5.23.0",
    "rocketride": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd /Users/nori/Desktop/blackbox && npm install`
Expected: `node_modules/` created, no errors. If `rocketride@^1.0.0` fails to resolve, run `npm view rocketride version` and pin the printed version in `package.json`, then re-run.

- [ ] **Step 5: Create `src/logger.ts`**

```ts
type Meta = Record<string, unknown>;
function line(level: string, msg: string, meta?: Meta) {
  const base = `[${new Date().toISOString()}] ${level} ${msg}`;
  if (meta) console.log(base, JSON.stringify(meta));
  else console.log(base);
}
export const logger = {
  info: (m: string, meta?: Meta) => line('INFO', m, meta),
  warn: (m: string, meta?: Meta) => line('WARN', m, meta),
  error: (m: string, meta?: Meta) => line('ERROR', m, meta),
};
```

- [ ] **Step 6: Write the failing test `tests/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

const base = {
  PORT: '8000', CORS_ORIGIN: 'http://localhost:3000',
  BUTTERBASE_API_URL: 'https://api.butterbase.ai', BUTTERBASE_APP_ID: 'app_x',
  BUTTERBASE_API_KEY: 'bb_sk_x', BUTTERBASE_BASE_URL: 'https://api.butterbase.ai/v1',
  BUTTERBASE_MODEL: 'anthropic/claude-sonnet-4.5',
  BUTTERBASE_RAG_COLLECTION: 'support-knowledge',
  NEO4J_URI: 'neo4j+s://x', NEO4J_USERNAME: 'neo4j', NEO4J_PASSWORD: 'p', NEO4J_DATABASE: 'neo4j',
};

describe('parseConfig', () => {
  it('parses a full env into typed config', () => {
    const c = parseConfig(base);
    expect(c.port).toBe(8000);
    expect(c.butterbase.appId).toBe('app_x');
    expect(c.butterbase.model).toBe('anthropic/claude-sonnet-4.5');
    expect(c.neo4j.database).toBe('neo4j');
  });

  it('defaults the port to 8000 to match the frontend', () => {
    const { PORT, ...noPort } = base;
    expect(parseConfig(noPort).port).toBe(8000);
  });

  it('detects placeholder Butterbase creds as not-configured', () => {
    expect(parseConfig({ ...base, BUTTERBASE_API_KEY: 'your_butterbase_server_api_key' }).butterbase.configured).toBe(false);
  });

  it('treats a real bb_sk_ key as configured', () => {
    expect(parseConfig(base).butterbase.configured).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 8: Implement `src/config.ts`**

```ts
import 'dotenv/config';

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.startsWith('your_') || v.includes('YOUR_') || v.trim() === '';
}

export interface Config {
  port: number;
  corsOrigin: string;
  butterbase: {
    apiUrl: string; appId: string; apiKey: string; llmBaseUrl: string; model: string;
    ragCollection: string; configured: boolean;
  };
  neo4j: { uri: string; username: string; password: string; database: string; configured: boolean };
  rocketride: { uri: string; apikey: string; configured: boolean };
  recordedAudioObjectId: string;
  flags: { recordedDemo: boolean; realPhone: boolean };
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const bbKey = env.BUTTERBASE_API_KEY ?? '';
  return {
    port: Number(env.PORT ?? 8000),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3000',
    butterbase: {
      apiUrl: env.BUTTERBASE_API_URL ?? 'https://api.butterbase.ai',
      appId: env.BUTTERBASE_APP_ID ?? '',
      apiKey: bbKey,
      llmBaseUrl: env.BUTTERBASE_BASE_URL ?? 'https://api.butterbase.ai/v1',
      model: env.BUTTERBASE_MODEL ?? env.BUTTERBASE_AI_MODEL ?? 'anthropic/claude-sonnet-4.5',
      ragCollection: env.BUTTERBASE_RAG_COLLECTION ?? 'support-knowledge',
      configured: !isPlaceholder(env.BUTTERBASE_APP_ID) && bbKey.startsWith('bb_sk_'),
    },
    neo4j: {
      uri: env.NEO4J_URI ?? '', username: env.NEO4J_USERNAME ?? 'neo4j',
      password: env.NEO4J_PASSWORD ?? '', database: env.NEO4J_DATABASE ?? 'neo4j',
      configured: !isPlaceholder(env.NEO4J_URI) && !isPlaceholder(env.NEO4J_PASSWORD),
    },
    rocketride: {
      uri: env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai',
      apikey: env.ROCKETRIDE_APIKEY ?? '',
      configured: !isPlaceholder(env.ROCKETRIDE_APIKEY),
    },
    recordedAudioObjectId: env.RECORDED_CALL_AUDIO_OBJECT_ID ?? '',
    flags: {
      recordedDemo: (env.ENABLE_RECORDED_CALL_DEMO ?? 'true') === 'true',
      realPhone: (env.ENABLE_REAL_PHONE_CALL ?? 'false') === 'true',
    },
  };
}

export const config = parseConfig(process.env as Record<string, string | undefined>);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/logger.ts src/config.ts tests/config.test.ts
git commit -m "chore: scaffold backend + typed config"
```

---

### Task 2: Shared domain types (frontend contract)

**Files:**
- Create: `src/types.ts`
- Test: none (type-only module).

**Interfaces:**
- Produces: `SessionStatus`, `Session`, `GraphNode`, `GraphEdge`, `GraphData`, `IvrDecision`, `ReasoningEntry`, `BriefingCard`, `ExtractedEntities`, `BriefingDossier`, `MockEmail`. Shapes for `Session/GraphNode/GraphEdge/GraphData/IvrDecision/ReasoningEntry/BriefingCard` are **copied verbatim** from `frontend/src/types/index.ts`.

- [ ] **Step 1: Create `src/types.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared domain types matching frontend contract"
```

---

### Task 3: Db interface + in-memory adapter

**Files:**
- Create: `src/db/interface.ts`, `src/db/memory.ts`
- Test: `tests/db-memory.test.ts`

**Interfaces:**
- Produces: `SessionRow` (= `Session`), `IvrDecisionRow`, `BriefingRow`, `ReasoningRow`; `Db` interface; `createMemoryDb(): Db`.

- [ ] **Step 1: Create `src/db/interface.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test `tests/db-memory.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../src/db/memory.js';

describe('memory db', () => {
  it('creates and reads a session with defaults', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'help' });
    expect(s.id).toBeTruthy();
    expect(s.status).toBe('extracting');
    expect((await db.getSession(s.id))?.user_input).toBe('help');
  });

  it('updates status and detected fields', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.updateSession(s.id, { status: 'on_hold', detected_company: 'Asiana Airlines' });
    const got = await db.getSession(s.id);
    expect(got?.status).toBe('on_hold');
    expect(got?.detected_company).toBe('Asiana Airlines');
  });

  it('appends and lists ivr decisions and reasoning', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.addIvrDecision({ session_id: s.id, prompt_text: 'For English press 2', decision: 'Press 2', reasoning: 'english' });
    await db.addReasoning({ session_id: s.id, phase: 'extraction', message: 'found booking' });
    expect(await db.listIvrDecisions(s.id)).toHaveLength(1);
    expect(await db.listReasoning(s.id)).toHaveLength(1);
  });

  it('stores and returns a briefing card', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.saveBriefingCard(s.id, { company: 'Asiana Airlines' }, 'Hi, I flew OZ212');
    const card = await db.getBriefingCard(s.id);
    expect((card?.card_json as { company: string }).company).toBe('Asiana Airlines');
    expect(card?.suggested_opening).toBe('Hi, I flew OZ212');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/db-memory.test.ts`
Expected: FAIL — cannot find `../src/db/memory.js`.

- [ ] **Step 4: Implement `src/db/memory.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Db, SessionRow, IvrDecisionRow, ReasoningRow } from './interface.js';

export function createMemoryDb(): Db {
  const sessions = new Map<string, SessionRow>();
  const ivr = new Map<string, IvrDecisionRow[]>();
  const reasoning = new Map<string, ReasoningRow[]>();
  const briefings = new Map<string, { card_json: unknown; suggested_opening: string | null }>();

  return {
    async createSession(input) {
      const row: SessionRow = {
        id: randomUUID(), user_input: input.user_input,
        detected_company: input.detected_company ?? null,
        detected_intent: input.detected_intent ?? null,
        status: 'extracting', created_at: new Date().toISOString(),
      };
      sessions.set(row.id, row);
      return row;
    },
    async getSession(id) { return sessions.get(id) ?? null; },
    async updateSession(id, patch) {
      const cur = sessions.get(id);
      if (cur) sessions.set(id, { ...cur, ...patch });
    },
    async addIvrDecision(r) {
      const row: IvrDecisionRow = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
      const list = ivr.get(r.session_id) ?? [];
      list.push(row); ivr.set(r.session_id, list);
      return row;
    },
    async listIvrDecisions(sessionId) { return ivr.get(sessionId) ?? []; },
    async saveBriefingCard(sessionId, cardJson, suggestedOpening) {
      briefings.set(sessionId, { card_json: cardJson, suggested_opening: suggestedOpening });
    },
    async getBriefingCard(sessionId) { return briefings.get(sessionId) ?? null; },
    async addReasoning(r) {
      const row: ReasoningRow = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
      const list = reasoning.get(r.session_id) ?? [];
      list.push(row); reasoning.set(r.session_id, list);
      return row;
    },
    async listReasoning(sessionId) { return reasoning.get(sessionId) ?? []; },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db-memory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/interface.ts src/db/memory.ts tests/db-memory.test.ts
git commit -m "feat: db interface + in-memory adapter"
```

---

### Task 4: Butterbase Db adapter + selector

**Files:**
- Create: `src/db/butterbase.ts`, `src/db/index.ts`
- Test: `tests/db-butterbase.integration.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3), `config` (Task 1).
- Produces: `createButterbaseDb(cfg): Db`, `createDb(): Db` (Butterbase when `config.butterbase.configured`, else memory).

**Note:** These request/response shapes were verified live against `app_cyc857msb86y`: `POST .../sessions` → 201 with the row; `GET .../sessions?limit=1` → `[]`; `DELETE` → `{deleted:true}`.

- [ ] **Step 1: Implement `src/db/butterbase.ts`**

```ts
import type { Config } from '../config.js';
import type { Db, SessionRow, IvrDecisionRow, ReasoningRow } from './interface.js';

export function createButterbaseDb(cfg: Config): Db {
  const base = `${cfg.butterbase.apiUrl}/v1/${cfg.butterbase.appId}`;
  const headers = { 'Authorization': `Bearer ${cfg.butterbase.apiKey}`, 'Content-Type': 'application/json' };

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Butterbase ${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
  }

  return {
    async createSession(input) {
      return req<SessionRow>('POST', '/sessions', {
        user_input: input.user_input,
        detected_company: input.detected_company ?? null,
        detected_intent: input.detected_intent ?? null,
        status: 'extracting',
      });
    },
    async getSession(id) {
      try { return await req<SessionRow>('GET', `/sessions/${id}`); }
      catch { return null; }
    },
    async updateSession(id, patch) { await req('PATCH', `/sessions/${id}`, patch); },
    async addIvrDecision(r) { return req<IvrDecisionRow>('POST', '/ivr_decisions', r); },
    async listIvrDecisions(sessionId) {
      return req<IvrDecisionRow[]>('GET', `/ivr_decisions?session_id=eq.${sessionId}&order=created_at.asc`);
    },
    async saveBriefingCard(sessionId, cardJson, suggestedOpening) {
      await req('POST', '/briefing_cards', { session_id: sessionId, card_json: cardJson, suggested_opening: suggestedOpening });
    },
    async getBriefingCard(sessionId) {
      const rows = await req<{ card_json: unknown; suggested_opening: string | null }[]>(
        'GET', `/briefing_cards?session_id=eq.${sessionId}&order=created_at.desc&limit=1`);
      return rows[0] ?? null;
    },
    async addReasoning(r) { return req<ReasoningRow>('POST', '/reasoning_events', r); },
    async listReasoning(sessionId) {
      return req<ReasoningRow[]>('GET', `/reasoning_events?session_id=eq.${sessionId}&order=created_at.asc`);
    },
  };
}
```

- [ ] **Step 2: Implement `src/db/index.ts`**

```ts
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Db } from './interface.js';
import { createMemoryDb } from './memory.js';
import { createButterbaseDb } from './butterbase.js';

export function createDb(): Db {
  if (config.butterbase.configured) {
    logger.info('db: using Butterbase Data API', { appId: config.butterbase.appId });
    return createButterbaseDb(config);
  }
  logger.warn('db: Butterbase not configured — using in-memory adapter');
  return createMemoryDb();
}
```

- [ ] **Step 3: Write the integration test `tests/db-butterbase.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { createButterbaseDb } from '../src/db/butterbase.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('butterbase db (live)', () => {
  it('round-trips a session and appends children', async () => {
    const db = createButterbaseDb(config);
    const s = await db.createSession({ user_input: 'integration test', detected_company: 'Asiana Airlines' });
    expect(s.id).toBeTruthy();
    await db.updateSession(s.id, { status: 'on_hold' });
    expect((await db.getSession(s.id))?.status).toBe('on_hold');
    await db.addReasoning({ session_id: s.id, phase: 'info', message: 'hello' });
    expect((await db.listReasoning(s.id)).length).toBeGreaterThanOrEqual(1);
    await db.saveBriefingCard(s.id, { company: 'Asiana Airlines' }, 'Hi');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run tests/db-butterbase.integration.test.ts`
Expected: PASS with real creds; SKIPPED otherwise. Both are green.

- [ ] **Step 5: Commit**

```bash
git add src/db/butterbase.ts src/db/index.ts tests/db-butterbase.integration.test.ts
git commit -m "feat: butterbase db adapter + selector"
```

---

### Task 5: SSE hub

**Files:**
- Create: `src/sse/hub.ts`
- Test: `tests/sse-hub.test.ts`

**Interfaces:**
- Produces: `SseEvent = { event: string; data: unknown }`; `SseHub` with `subscribe(sessionId, listener): () => void`, `publish(sessionId, event, data): void`, `replayBuffer(sessionId): SseEvent[]`.

- [ ] **Step 1: Write the failing test `tests/sse-hub.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSseHub } from '../src/sse/hub.js';

describe('sse hub', () => {
  it('delivers published events to subscribers of the same session', () => {
    const hub = createSseHub();
    const a = vi.fn();
    hub.subscribe('s1', a);
    hub.publish('s1', 'status', { status: 'dialing' });
    expect(a).toHaveBeenCalledWith({ event: 'status', data: { status: 'dialing' } });
  });

  it('does not deliver across sessions', () => {
    const hub = createSseHub();
    const a = vi.fn();
    hub.subscribe('s1', a);
    hub.publish('s2', 'status', {});
    expect(a).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const hub = createSseHub();
    const a = vi.fn();
    const off = hub.subscribe('s1', a);
    off();
    hub.publish('s1', 'status', {});
    expect(a).not.toHaveBeenCalled();
  });

  it('buffers events for replay to late subscribers', () => {
    const hub = createSseHub();
    hub.publish('s1', 'graph', { nodes: [], edges: [] });
    expect(hub.replayBuffer('s1')).toEqual([{ event: 'graph', data: { nodes: [], edges: [] } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sse-hub.test.ts`
Expected: FAIL — cannot find `../src/sse/hub.js`.

- [ ] **Step 3: Implement `src/sse/hub.ts`**

```ts
export interface SseEvent { event: string; data: unknown; }
type Listener = (e: SseEvent) => void;

export interface SseHub {
  subscribe(sessionId: string, listener: Listener): () => void;
  publish(sessionId: string, event: string, data: unknown): void;
  replayBuffer(sessionId: string): SseEvent[];
}

export function createSseHub(): SseHub {
  const listeners = new Map<string, Set<Listener>>();
  const buffers = new Map<string, SseEvent[]>();

  return {
    subscribe(sessionId, listener) {
      const set = listeners.get(sessionId) ?? new Set();
      set.add(listener); listeners.set(sessionId, set);
      return () => set.delete(listener);
    },
    publish(sessionId, event, data) {
      const e: SseEvent = { event, data };
      const buf = buffers.get(sessionId) ?? [];
      buf.push(e); buffers.set(sessionId, buf);
      for (const l of listeners.get(sessionId) ?? []) l(e);
    },
    replayBuffer(sessionId) { return buffers.get(sessionId) ?? []; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sse-hub.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sse/hub.ts tests/sse-hub.test.ts
git commit -m "feat: per-session SSE hub with replay buffer"
```

---

### Task 6: Neo4j driver + schema

**Files:**
- Create: `src/graph/neo4j.ts`
- Test: `tests/neo4j-connect.integration.test.ts`

**Interfaces:**
- Consumes: `config`.
- Produces: `getDriver()`, `runWrite(cypher, params)`, `runRead(cypher, params)`, `initSchema()`, `closeDriver()`, `neo4jConfigured()`.

- [ ] **Step 1: Implement `src/graph/neo4j.ts`**

```ts
import neo4j, { type Driver } from 'neo4j-driver';
import { config } from '../config.js';

let driver: Driver | null = null;

export function neo4jConfigured(): boolean { return config.neo4j.configured; }

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.username, config.neo4j.password));
  }
  return driver;
}

export async function runWrite<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const res = await session.executeWrite((tx) => tx.run(cypher, params));
    return res.records.map((r) => r.toObject() as T);
  } finally { await session.close(); }
}

export async function runRead<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const res = await session.executeRead((tx) => tx.run(cypher, params));
    return res.records.map((r) => r.toObject() as T);
  } finally { await session.close(); }
}

const CONSTRAINTS = [
  'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT booking_pnr IF NOT EXISTS FOR (b:Booking) REQUIRE b.pnr IS UNIQUE',
  'CREATE CONSTRAINT flight_key IF NOT EXISTS FOR (f:Flight) REQUIRE (f.number, f.date) IS UNIQUE',
  'CREATE CONSTRAINT loyalty_number IF NOT EXISTS FOR (l:LoyaltyAccount) REQUIRE l.number IS UNIQUE',
  'CREATE CONSTRAINT airport_code IF NOT EXISTS FOR (a:Airport) REQUIRE a.code IS UNIQUE',
  'CREATE CONSTRAINT airline_name IF NOT EXISTS FOR (a:Airline) REQUIRE a.name IS UNIQUE',
  'CREATE CONSTRAINT email_id IF NOT EXISTS FOR (e:Email) REQUIRE e.id IS UNIQUE',
  'CREATE CONSTRAINT attachment_tag IF NOT EXISTS FOR (t:Attachment) REQUIRE t.tag IS UNIQUE',
];

export async function initSchema(): Promise<void> {
  for (const c of CONSTRAINTS) await runWrite(c);
}

export async function closeDriver(): Promise<void> {
  if (driver) { await driver.close(); driver = null; }
}
```

- [ ] **Step 2: Write the integration test `tests/neo4j-connect.integration.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, runRead, closeDriver } from '../src/graph/neo4j.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => { await closeDriver(); });

run('neo4j (live)', () => {
  it('connects, applies schema, runs a read', async () => {
    await initSchema();
    const rows = await runRead<{ ok: number }>('RETURN 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run tests/neo4j-connect.integration.test.ts`
Expected: PASS once `NEO4J_PASSWORD` is correct; SKIPPED if not configured. If it FAILS with `Neo.ClientError.Security.Unauthorized`, the `.env` password is wrong — stop and fix it.

- [ ] **Step 4: Commit**

```bash
git add src/graph/neo4j.ts tests/neo4j-connect.integration.test.ts
git commit -m "feat: neo4j driver + schema constraints"
```

---

### Task 7: Graph ingestion (Asiana entities → MERGE)

**Files:**
- Create: `src/graph/ingest.ts`
- Test: `tests/graph-ingest.integration.test.ts`

**Interfaces:**
- Consumes: `runWrite` (Task 6), `ExtractedEntities`, `MockEmail` (Task 2).
- Produces: `ingestEmail(userId, email, entities): Promise<void>` (idempotent MERGE). `DEMO_USER_ID = 'steven-yang'`. Relationships: `HAS_BOOKING`, `INCLUDES`, `OPERATED_BY` (Flight→Airline), `HAS_LOYALTY`, `PAID_WITH`, `DEPARTS_FROM` (Flight→origin), `ARRIVES_AT` (Flight→destination), `HAS_BAGGAGE` (Booking→Attachment).

- [ ] **Step 1: Write the integration test `tests/graph-ingest.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, runWrite, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => { await closeDriver(); });
const email: MockEmail = { id: 'test-conf-1', from: 'no-reply@flyasiana.com', to: 's@x.com', subject: 'Confirmation XKRF2M', date: '2026-06-20T00:00:00Z', body: '...' };

run('graph ingest (live)', () => {
  beforeAll(async () => {
    await initSchema();
    await runWrite('MATCH (n) WHERE n.id STARTS WITH "test-" OR n.pnr = "ZZ999" OR n.tag = "TESTTAG" DETACH DELETE n');
  });

  it('creates booking+flight+airline+baggage and links them', async () => {
    await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Steven Yang', email: 's@x.com' },
      booking: { pnr: 'ZZ999', airline: 'Asiana Airlines' },
      flight: { number: 'OZ212', date: '2026-07-03', route: 'ICN → SFO', from: 'ICN', to: 'SFO', status: 'completed', airline: 'Asiana Airlines' },
      baggage: { tag: 'TESTTAG', damage: 'broken handle' },
    });
    const linked = await runWrite<{ c: number }>(
      'MATCH (:Person {id:$u})-[:HAS_BOOKING]->(:Booking {pnr:"ZZ999"})-[:INCLUDES]->(:Flight {number:"OZ212"})-[:OPERATED_BY]->(:Airline {name:"Asiana Airlines"}) RETURN count(*) AS c',
      { u: DEMO_USER_ID });
    expect(Number(linked[0].c)).toBe(1);
    const bag = await runWrite<{ c: number }>('MATCH (:Booking {pnr:"ZZ999"})-[:HAS_BAGGAGE]->(:Attachment {tag:"TESTTAG"}) RETURN count(*) AS c');
    expect(Number(bag[0].c)).toBe(1);
  });

  it('is idempotent across repeated ingest', async () => {
    await ingestEmail(DEMO_USER_ID, email, { booking: { pnr: 'ZZ999' } });
    const rows = await runWrite<{ c: number }>('MATCH (b:Booking {pnr:"ZZ999"}) RETURN count(b) AS c');
    expect(Number(rows[0].c)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-ingest.integration.test.ts`
Expected: FAIL — cannot find `../src/graph/ingest.js` (or SKIPPED if Neo4j unconfigured).

- [ ] **Step 3: Implement `src/graph/ingest.ts`**

```ts
import { runWrite } from './neo4j.js';
import type { ExtractedEntities, MockEmail } from '../types.js';

export const DEMO_USER_ID = 'steven-yang';

export async function ingestEmail(userId: string, email: MockEmail, e: ExtractedEntities): Promise<void> {
  // Email node (provenance)
  await runWrite('MERGE (e:Email {id:$id}) SET e.subject=$subject, e.date=$date, e.from=$from',
    { id: email.id, subject: email.subject, date: email.date, from: email.from });

  const personId = e.person?.id ?? userId;
  await runWrite('MERGE (p:Person {id:$id}) SET p.name=coalesce($name, p.name), p.email=coalesce($email, p.email)',
    { id: personId, name: e.person?.name ?? null, email: e.person?.email ?? null });

  const airlineName = e.booking?.airline ?? e.flight?.airline ?? null;
  if (airlineName) await runWrite('MERGE (a:Airline {name:$name})', { name: airlineName });

  if (e.booking?.pnr) {
    await runWrite('MERGE (b:Booking {pnr:$pnr}) SET b.airline=coalesce($airline,b.airline)',
      { pnr: e.booking.pnr, airline: airlineName });
    await runWrite('MATCH (p:Person {id:$u}),(b:Booking {pnr:$pnr}) MERGE (p)-[:HAS_BOOKING]->(b)',
      { u: personId, pnr: e.booking.pnr });
  }

  if (e.flight?.number && e.flight?.date) {
    await runWrite(
      'MERGE (f:Flight {number:$n, date:$d}) SET f.route=$route, f.status=$status, f.airline=$airline, f.from=$from, f.to=$to',
      { n: e.flight.number, d: e.flight.date, route: e.flight.route ?? null, status: e.flight.status ?? null,
        airline: e.flight.airline ?? airlineName, from: e.flight.from ?? null, to: e.flight.to ?? null });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(f:Flight {number:$n,date:$d}) MERGE (b)-[:INCLUDES]->(f)',
        { pnr: e.booking.pnr, n: e.flight.number, d: e.flight.date });
    }
    if (airlineName) {
      await runWrite('MATCH (f:Flight {number:$n,date:$d}),(a:Airline {name:$name}) MERGE (f)-[:OPERATED_BY]->(a)',
        { n: e.flight.number, d: e.flight.date, name: airlineName });
    }
    for (const [code, rel] of [[e.flight.from, 'DEPARTS_FROM'], [e.flight.to, 'ARRIVES_AT']] as const) {
      if (code) {
        await runWrite('MERGE (a:Airport {code:$c})', { c: code });
        await runWrite(`MATCH (f:Flight {number:$n,date:$d}),(a:Airport {code:$c}) MERGE (f)-[:${rel}]->(a)`,
          { n: e.flight.number, d: e.flight.date, c: code });
      }
    }
  }

  if (e.loyalty?.number) {
    await runWrite('MERGE (l:LoyaltyAccount {number:$num}) SET l.program=$program, l.airline=$airline',
      { num: e.loyalty.number, program: e.loyalty.program ?? null, airline: e.loyalty.airline ?? airlineName });
    await runWrite('MATCH (p:Person {id:$u}),(l:LoyaltyAccount {number:$num}) MERGE (p)-[:HAS_LOYALTY]->(l)',
      { u: personId, num: e.loyalty.number });
  }

  if (e.payment?.last4) {
    const pkey = `${e.payment.brand ?? 'card'}-${e.payment.last4}`;
    await runWrite('MERGE (pm:PaymentMethod {key:$k}) SET pm.brand=$brand, pm.last4=$last4',
      { k: pkey, brand: e.payment.brand ?? null, last4: e.payment.last4 });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(pm:PaymentMethod {key:$k}) MERGE (b)-[:PAID_WITH]->(pm)',
        { pnr: e.booking.pnr, k: pkey });
    }
  }

  if (e.baggage?.tag) {
    await runWrite('MERGE (t:Attachment {tag:$tag}) SET t.damage=coalesce($damage,t.damage)',
      { tag: e.baggage.tag, damage: e.baggage.damage ?? null });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(t:Attachment {tag:$tag}) MERGE (b)-[:HAS_BAGGAGE]->(t)',
        { pnr: e.booking.pnr, tag: e.baggage.tag });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-ingest.integration.test.ts`
Expected: PASS (2 tests) with live Neo4j; SKIPPED otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/graph/ingest.ts tests/graph-ingest.integration.test.ts
git commit -m "feat: neo4j Asiana entity ingestion (idempotent MERGE)"
```

---

### Task 8: Graph read + briefing dossier query

**Files:**
- Create: `src/graph/query.ts`
- Test: `tests/graph-query.integration.test.ts`

**Interfaces:**
- Consumes: `runRead` (Task 6), `GraphData`, `BriefingDossier` (Task 2).
- Produces: `getGraph(): Promise<GraphData>` (nodes `{id,label,type}`, edges `{id,source,target,type}` — matching the frontend), `assembleBriefing(userId): Promise<BriefingDossier | null>`.

- [ ] **Step 1: Write the integration test `tests/graph-query.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import { getGraph, assembleBriefing } from '../src/graph/query.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => { await closeDriver(); });
const email: MockEmail = { id: 'test-q-1', from: 'x', to: 'y', subject: 's', date: '2026-06-20T00:00:00Z', body: '' };

run('graph query (live)', () => {
  beforeAll(async () => {
    await initSchema();
    await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Steven Yang' },
      booking: { pnr: 'XKRF2M', airline: 'Asiana Airlines' },
      flight: { number: 'OZ212', date: '2026-07-03', route: 'ICN → SFO', from: 'ICN', to: 'SFO', status: 'completed', airline: 'Asiana Airlines' },
      loyalty: { program: 'Asiana Club', number: '920384712', airline: 'Asiana Airlines' },
      payment: { brand: 'American Express', last4: '1087' },
      baggage: { tag: '0988-7234', damage: 'broken handle' },
    });
  });

  it('assembles the full dossier in one query', async () => {
    const d = await assembleBriefing(DEMO_USER_ID);
    expect(d?.pnr).toBe('XKRF2M');
    expect(d?.flight_number).toBe('OZ212');
    expect(d?.loyalty_number).toBe('920384712');
    expect(d?.payment_last4).toBe('1087');
    expect(d?.baggage_tag).toBe('0988-7234');
  });

  it('returns nodes/edges with source/target for visualization', async () => {
    const g = await getGraph();
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.edges[0]).toHaveProperty('source');
    expect(g.edges[0]).toHaveProperty('target');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-query.integration.test.ts`
Expected: FAIL — cannot find `../src/graph/query.js` (or SKIPPED).

- [ ] **Step 3: Implement `src/graph/query.ts`**

```ts
import { runRead } from './neo4j.js';
import type { GraphData, GraphNode, GraphEdge, NodeType, BriefingDossier } from '../types.js';

export async function getGraph(): Promise<GraphData> {
  const nodeRows = await runRead<{ id: string; labels: string[]; props: Record<string, unknown> }>(
    'MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props');
  const edgeRows = await runRead<{ id: string; source: string; target: string; type: string }>(
    'MATCH (a)-[r]->(b) RETURN elementId(r) AS id, elementId(a) AS source, elementId(b) AS target, type(r) AS type');

  const nodes: GraphNode[] = nodeRows.map((r) => {
    const type = (r.labels[0] ?? 'Person') as NodeType;
    const p = r.props;
    const label = (p.name ?? p.pnr ?? p.number ?? p.code ?? p.tag ?? p.brand ?? p.subject ?? type) as string;
    return { id: r.id, type, label: String(label) };
  });
  const edges: GraphEdge[] = edgeRows.map((r) => ({ id: r.id, source: r.source, target: r.target, type: r.type }));
  return { nodes, edges };
}

export async function assembleBriefing(userId: string): Promise<BriefingDossier | null> {
  const rows = await runRead<BriefingDossier>(
    `MATCH (u:Person {id:$user})-[:HAS_BOOKING]->(b:Booking)-[:INCLUDES]->(f:Flight)
     OPTIONAL MATCH (u)-[:HAS_LOYALTY]->(l:LoyaltyAccount)
       WHERE l.airline IS NULL OR f.airline IS NULL OR l.airline = f.airline
     OPTIONAL MATCH (b)-[:PAID_WITH]->(p:PaymentMethod)
     OPTIONAL MATCH (b)-[:HAS_BAGGAGE]->(t:Attachment)
     RETURN b.pnr AS pnr, f.number AS flight_number, f.date AS date, f.route AS route, f.status AS status,
            u.name AS name, l.program AS loyalty_program, l.number AS loyalty_number,
            p.brand AS payment_brand, p.last4 AS payment_last4, t.tag AS baggage_tag
     LIMIT 1`,
    { user: userId });
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-query.integration.test.ts`
Expected: PASS (2 tests) with live Neo4j; SKIPPED otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/graph/query.ts tests/graph-query.integration.test.ts
git commit -m "feat: graph read (source/target) + one-query briefing dossier"
```

---

### Task 9: Briefing card assembly (pure)

**Files:**
- Create: `src/briefing/assemble.ts`
- Test: `tests/briefing-assemble.test.ts`

**Interfaces:**
- Consumes: `BriefingDossier`, `BriefingCard` (Task 2).
- Produces: `assembleCard(dossier, ctx: { company; intent; location; urgency }): BriefingCard`, `buildSuggestedOpening(card, baggageTag?): string`. All `BriefingCard` string fields default to `''` when the dossier lacks them (frontend types are non-optional strings).

- [ ] **Step 1: Write the failing test `tests/briefing-assemble.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleCard } from '../src/briefing/assemble.js';

const ctx = { company: 'Asiana Airlines', intent: 'File baggage damage claim', location: 'San Francisco', urgency: 'Suitcase broken on arrival — need damage claim filed within 7 days' };

describe('assembleCard', () => {
  it('maps a full dossier into the frontend card shape with a baggage-claim opening', () => {
    const card = assembleCard({
      pnr: 'XKRF2M', flight_number: 'OZ212', route: 'ICN → SFO', date: '2026-07-03', status: 'completed',
      name: 'Steven Yang', loyalty_program: 'Asiana Club', loyalty_number: '920384712',
      payment_brand: 'American Express', payment_last4: '1087', baggage_tag: '0988-7234',
    }, ctx);
    expect(card.company).toBe('Asiana Airlines');
    expect(card.booking.pnr).toBe('XKRF2M');
    expect(card.booking.flight_number).toBe('OZ212');
    expect(card.payment.last4).toBe('1087');
    expect(card.suggested_opening).toContain('OZ212');
    expect(card.suggested_opening).toContain('XKRF2M');
    expect(card.suggested_opening).toContain('0988-7234');       // baggage tag
    expect(card.suggested_opening).toContain('920384712');       // Asiana Club
  });

  it('degrades gracefully on a null dossier (all strings present, no crash)', () => {
    const card = assembleCard(null, ctx);
    expect(card.company).toBe('Asiana Airlines');
    expect(card.booking.pnr).toBe('');
    expect(card.identity.name).toBe('');
    expect(card.suggested_opening.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/briefing-assemble.test.ts`
Expected: FAIL — cannot find `../src/briefing/assemble.js`.

- [ ] **Step 3: Implement `src/briefing/assemble.ts`**

```ts
import type { BriefingDossier, BriefingCard } from '../types.js';

const s = (v: string | undefined): string => v ?? '';

export function buildSuggestedOpening(card: BriefingCard, baggageTag: string): string {
  const parts: string[] = ['Hi,'];
  if (card.booking.flight_number && card.booking.route) {
    parts.push(`I flew on ${card.company} flight ${card.booking.flight_number} from ${card.booking.route}` +
      (card.booking.date ? ` on ${card.booking.date}` : '') +
      (card.booking.pnr ? `, booking reference ${card.booking.pnr}.` : '.'));
  } else if (card.booking.pnr) {
    parts.push(`I have booking reference ${card.booking.pnr} with ${card.company}.`);
  }
  parts.push('My checked suitcase was damaged during the flight and I need to file a damage claim.');
  if (baggageTag) parts.push(`My baggage tag number is ${baggageTag}.`);
  if (card.identity.loyalty_program && card.identity.loyalty_number) {
    parts.push(`My ${card.identity.loyalty_program} number is ${card.identity.loyalty_number}.`);
  }
  return parts.join(' ');
}

export function assembleCard(
  d: BriefingDossier | null,
  ctx: { company: string; intent: string; location: string; urgency: string },
): BriefingCard {
  const card: BriefingCard = {
    company: ctx.company,
    user_intent: ctx.intent,
    identity: { name: s(d?.name), loyalty_program: s(d?.loyalty_program), loyalty_number: s(d?.loyalty_number) },
    booking: { pnr: s(d?.pnr), flight_number: s(d?.flight_number), route: s(d?.route), date: s(d?.date), status: s(d?.status) },
    payment: { brand: s(d?.payment_brand), last4: s(d?.payment_last4) },
    context: { user_location: ctx.location, urgency: ctx.urgency },
    suggested_opening: '',
  };
  card.suggested_opening = buildSuggestedOpening(card, s(d?.baggage_tag));
  return card;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/briefing-assemble.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/briefing/assemble.ts tests/briefing-assemble.test.ts
git commit -m "feat: briefing card assembly + baggage-claim opening"
```

---

### Task 10: Mock inbox fixtures (Asiana)

**Files:**
- Create: `src/demo/inbox.ts`
- Test: `tests/inbox.test.ts`

**Interfaces:**
- Consumes: `MockEmail` (Task 2).
- Produces: `MOCK_INBOX: MockEmail[]` (~15 Asiana emails: OZ212/XKRF2M confirmation, Asiana Club #920384712 welcome, Amex ••1087 statement, baggage tag #0988-7234 / damage report, arrival notice, plus decoys). `EXPECTED_DOSSIER` for cross-checking.

- [ ] **Step 1: Write the failing test `tests/inbox.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MOCK_INBOX } from '../src/demo/inbox.js';

describe('mock inbox', () => {
  it('has ~15 emails with unique ids', () => {
    expect(MOCK_INBOX.length).toBeGreaterThanOrEqual(12);
    expect(new Set(MOCK_INBOX.map((e) => e.id)).size).toBe(MOCK_INBOX.length);
  });
  it('contains the load-bearing Asiana signal emails', () => {
    const bodies = MOCK_INBOX.map((e) => `${e.subject} ${e.body}`).join(' ');
    expect(bodies).toContain('OZ212');
    expect(bodies).toContain('XKRF2M');
    expect(bodies).toContain('920384712');   // Asiana Club
    expect(bodies).toContain('1087');          // Amex last4
    expect(bodies).toContain('0988-7234');     // baggage tag
  });
  it('includes decoys (unrelated bookings) to force discrimination', () => {
    expect(MOCK_INBOX.some((e) => /delta|hotel|promo|amazon|united/i.test(`${e.subject} ${e.from}`))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inbox.test.ts`
Expected: FAIL — cannot find `../src/demo/inbox.js`.

- [ ] **Step 3: Implement `src/demo/inbox.ts`**

```ts
import type { MockEmail } from '../types.js';

export const MOCK_INBOX: MockEmail[] = [
  { id: 'em-asiana-conf', from: 'no-reply@flyasiana.com', to: 'steven@example.com',
    subject: 'Your Asiana booking is confirmed — XKRF2M',
    date: '2026-06-15T09:00:00Z',
    body: 'Confirmation XKRF2M. Flight OZ212 from Seoul Incheon (ICN) to San Francisco (SFO) on July 3, 2026. Passenger: Steven Yang.' },
  { id: 'em-asiana-club', from: 'club@flyasiana.com', to: 'steven@example.com',
    subject: 'Welcome to Asiana Club', date: '2024-02-10T09:00:00Z',
    body: 'Your Asiana Club membership number is 920384712. Earn miles on every flight.' },
  { id: 'em-amex', from: 'statements@americanexpress.com', to: 'steven@example.com',
    subject: 'Your American Express statement is ready', date: '2026-06-20T00:00:00Z',
    body: 'Card ending 1087. Recent charge: ASIANA AIRLINES $1,240.55 on Jun 15.' },
  { id: 'em-baggage', from: 'no-reply@flyasiana.com', to: 'steven@example.com',
    subject: 'Baggage receipt — OZ212',
    date: '2026-07-03T18:20:00Z',
    body: 'Checked baggage for flight OZ212. Baggage tag number 0988-7234. 1 checked bag to SFO.' },
  { id: 'em-arrival', from: 'no-reply@flyasiana.com', to: 'steven@example.com',
    subject: 'Thanks for flying Asiana — OZ212 has arrived',
    date: '2026-07-03T19:05:00Z',
    body: 'Your flight OZ212 (ICN to SFO) on July 3 has arrived. We hope you enjoyed your trip, Steven.' },
  // --- decoys ---
  { id: 'em-delta-old', from: 'noreply@delta.com', to: 'steven@example.com',
    subject: 'Delta itinerary DL55 — last year', date: '2025-03-02T00:00:00Z',
    body: 'Confirmation JKL999, Delta DL55 JFK->LAX. Unrelated old trip.' },
  { id: 'em-hotel', from: 'reservations@marriott.com', to: 'steven@example.com',
    subject: 'Your Marriott reservation in San Francisco', date: '2026-06-30T00:00:00Z',
    body: 'Reservation MAR777 for July 3-5. Not an airline booking.' },
  { id: 'em-promo-asiana', from: 'deals@flyasiana.com', to: 'steven@example.com',
    subject: 'Fall fare sale — save 25%', date: '2026-06-10T00:00:00Z',
    body: 'Promotional offer. No booking details.' },
  { id: 'em-amazon', from: 'ship-confirm@amazon.com', to: 'steven@example.com',
    subject: 'Your Amazon order has shipped', date: '2026-06-28T00:00:00Z',
    body: 'Order 111-222 shipped. Card ending 9999.' },
  { id: 'em-newsletter', from: 'news@thepointsguy.com', to: 'steven@example.com',
    subject: 'This week in points', date: '2026-07-01T00:00:00Z', body: 'Travel newsletter content.' },
  { id: 'em-uber', from: 'receipts@uber.com', to: 'steven@example.com',
    subject: 'Your trip receipt', date: '2026-07-03T20:00:00Z', body: 'Trip from SFO airport $52.10, card ending 1087.' },
  { id: 'em-united-old', from: 'noreply@united.com', to: 'steven@example.com',
    subject: 'United booking QWE111', date: '2024-11-01T00:00:00Z', body: 'Old United trip, unrelated.' },
  { id: 'em-work', from: 'boss@example.com', to: 'steven@example.com',
    subject: 'Re: Welcome back from Seoul', date: '2026-07-04T00:00:00Z', body: 'Glad you made it home. See you Monday.' },
  { id: 'em-checkin', from: 'no-reply@flyasiana.com', to: 'steven@example.com',
    subject: 'Check in for your flight OZ212', date: '2026-07-02T12:00:00Z',
    body: 'Check in now for OZ212 on July 3, confirmation XKRF2M.' },
  { id: 'em-amex-promo', from: 'offers@americanexpress.com', to: 'steven@example.com',
    subject: 'A new offer for you', date: '2026-06-05T00:00:00Z', body: 'Promotional. No statement details.' },
];

export const EXPECTED_DOSSIER = {
  pnr: 'XKRF2M', flight_number: 'OZ212', route: 'ICN → SFO',
  loyalty_number: '920384712', payment_last4: '1087', baggage_tag: '0988-7234',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inbox.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demo/inbox.ts tests/inbox.test.ts
git commit -m "feat: Asiana mock inbox fixtures with decoys"
```

---

### Task 11: Butterbase AI gateway (intent + IVR decisions)

**Files:**
- Create: `src/ai/gateway.ts`, `src/ai/intent.ts`, `src/ai/ivr.ts`
- Test: `tests/ai-parse.test.ts`, `tests/ai.integration.test.ts`

**Interfaces:**
- Consumes: `config`.
- Produces: `chatJson<T>(system, user): Promise<T>`, `extractJsonBlock(text): string`; `detectCompanyIntent(userInput): Promise<{ company: string; intent: string }>`; `decideIvrAction(promptText, ragContext): Promise<{ decision: string; reasoning: string }>`.

- [ ] **Step 1: Write the failing unit test `tests/ai-parse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { extractJsonBlock } from '../src/ai/gateway.js';

describe('extractJsonBlock', () => {
  it('strips ```json fences', () => { expect(JSON.parse(extractJsonBlock('```json\n{"a":1}\n```')).a).toBe(1); });
  it('returns bare json unchanged', () => { expect(JSON.parse(extractJsonBlock('{"b":2}')).b).toBe(2); });
  it('grabs the first object out of chatty text', () => { expect(JSON.parse(extractJsonBlock('Sure! {"c":3} hope that helps')).c).toBe(3); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-parse.test.ts`
Expected: FAIL — cannot find `../src/ai/gateway.js`.

- [ ] **Step 3: Implement `src/ai/gateway.ts`**

```ts
import { config } from '../config.js';

export function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

export async function chatJson<T>(system: string, user: string): Promise<T> {
  const url = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.butterbase.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0, max_tokens: 500,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(extractJsonBlock(data.choices[0].message.content)) as T;
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run tests/ai-parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `src/ai/intent.ts`**

```ts
import { chatJson } from './gateway.js';

export async function detectCompanyIntent(userInput: string): Promise<{ company: string; intent: string }> {
  return chatJson(
    'You identify the target company and the support intent from a customer complaint. ' +
    'Respond ONLY with JSON: {"company": string, "intent": string}. ' +
    'intent is a short snake_case slug like baggage_damage_claim or refund_request.',
    userInput,
  );
}
```

- [ ] **Step 6: Implement `src/ai/ivr.ts`**

```ts
import { chatJson } from './gateway.js';

export async function decideIvrAction(promptText: string, ragContext: string): Promise<{ decision: string; reasoning: string }> {
  return chatJson(
    'You are navigating a phone IVR to reach a human agent for a baggage damage claim with Asiana Airlines. ' +
    'Given the IVR prompt and reference context, decide the single next action. ' +
    'Respond ONLY with JSON: {"decision": string, "reasoning": string}. ' +
    'decision is like "Press 2", "Press 5", or "Entered 920384712*".',
    `IVR prompt: ${promptText}\n\nReference context:\n${ragContext}`,
  );
}
```

- [ ] **Step 7: Write the integration test `tests/ai.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { detectCompanyIntent } from '../src/ai/intent.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('ai gateway (live)', () => {
  it('detects Asiana + a baggage/claim intent from the demo complaint', async () => {
    const r = await detectCompanyIntent('Asiana broke my suitcase on my recent flight and I need to file a damage claim.');
    expect(r.company.toLowerCase()).toContain('asiana');
    expect(r.intent.toLowerCase()).toMatch(/baggage|damage|claim/);
  });
});
```

- [ ] **Step 8: Run integration test**

Run: `npx vitest run tests/ai.integration.test.ts`
Expected: PASS with live creds; SKIPPED otherwise.

- [ ] **Step 9: Commit**

```bash
git add src/ai/gateway.ts src/ai/intent.ts src/ai/ivr.ts tests/ai-parse.test.ts tests/ai.integration.test.ts
git commit -m "feat: butterbase AI gateway — intent + IVR decisions"
```

---

### Task 12: RAG seed + IVR context query (Asiana)

**Files:**
- Create: `src/rag/query.ts`, `src/seed/seed-rag.ts`
- Test: `tests/rag.integration.test.ts`

**Interfaces:**
- Consumes: `config`.
- Produces: `getIvrContext(query): Promise<string>` (Butterbase `rag_query` REST, `synthesize:true`, returns answer/joined chunks, `''` on failure). `seed-rag.ts` ingests the Asiana IVR map + baggage-claim policy into `support-knowledge`.

**Note:** Confirm the RAG REST path against `butterbase_docs` topic `rag`/`rest` at implementation time. The shape below (`POST /v1/{app_id}/rag/{collection}/query` and `.../documents`) is the expected form. If a call 404s, GET the docs, fix the path in both files, and re-run.

- [ ] **Step 1: Implement `src/rag/query.ts`**

```ts
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function getIvrContext(query: string): Promise<string> {
  try {
    const url = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/rag/${config.butterbase.ragCollection}/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: 3, synthesize: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { logger.warn('rag query failed', { status: res.status }); return ''; }
    const data = await res.json() as { answer?: string; chunks?: { text: string }[] };
    return data.answer ?? (data.chunks ?? []).map((c) => c.text).join('\n');
  } catch (e) { logger.warn('rag query error', { error: String(e) }); return ''; }
}
```

- [ ] **Step 2: Implement `src/seed/seed-rag.ts`**

```ts
import { config } from '../config.js';
import { logger } from '../logger.js';

const DOCS = [
  { title: 'asiana-ivr-map',
    text: 'Asiana Airlines US phone tree (1-800-227-4262). Main menu: for assistance in English press 2. ' +
          'Next menu: arrival and departure info press 1, flight schedule press 2, Asiana Club press 3, ' +
          'reservation and ticketing press 4, to speak to an agent press 5. ' +
          'Baggage submenu: for U.S. departures or arrival baggage info press 1, seat assignment press 2, ' +
          'unaccompanied minor or pets press 3, contact numbers press 4, internet support press 5, all other inquiries press 6. ' +
          'To reach a human agent for a baggage damage claim: press 2 (English) -> press 5 (agent) -> press 1 (US arrival baggage) -> ' +
          'enter Asiana Club membership number followed by star -> hold for an agent.' },
  { title: 'asiana-baggage-damage-policy',
    text: 'Asiana Airlines damaged-baggage policy: report damage to checked baggage within 7 days of arrival. ' +
          'Have your booking reference (PNR), flight number, baggage tag number, and Asiana Club number ready. ' +
          'Damage claims for international arrivals are handled by the arrival-city baggage service office.' },
  { title: 'asiana-club-priority',
    text: 'Asiana Club members can enter their membership number in the IVR to authenticate and expedite service. ' +
          'Higher-tier members receive shorter hold times.' },
];

async function main() {
  if (!config.butterbase.configured) { logger.error('Butterbase not configured — cannot seed RAG'); process.exit(1); }
  const base = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/rag/${config.butterbase.ragCollection}/documents`;
  for (const doc of DOCS) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc.text, filename: `${doc.title}.txt`, metadata: { title: doc.title } }),
    });
    logger.info('seeded rag doc', { title: doc.title, status: res.status });
  }
}
main().catch((e) => { logger.error('seed failed', { error: String(e) }); process.exit(1); });
```

- [ ] **Step 3: Run the seed script (requires live Butterbase)**

Run: `npm run seed:rag`
Expected: three "seeded rag doc" lines with 2xx statuses. If a 404/400 appears, GET `butterbase_docs` topic `rag` for the exact ingest path, fix `seed-rag.ts` + `query.ts`, and re-run. Wait ~30s for embedding.

- [ ] **Step 4: Write the integration test `tests/rag.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { getIvrContext } from '../src/rag/query.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('rag (live)', () => {
  it('retrieves the Asiana path-to-human / baggage context', async () => {
    const ctx = await getIvrContext('How do I reach an Asiana agent to file a baggage damage claim?');
    expect(ctx.toLowerCase()).toMatch(/agent|press|baggage|5/);
  });
});
```

- [ ] **Step 5: Run integration test**

Run: `npx vitest run tests/rag.integration.test.ts`
Expected: PASS after seeding; SKIPPED if unconfigured.

- [ ] **Step 6: Commit**

```bash
git add src/rag/query.ts src/seed/seed-rag.ts tests/rag.integration.test.ts
git commit -m "feat: Asiana RAG seed + IVR context query"
```

---

### Task 13: RocketRide extraction with Butterbase fallback

**Files:**
- Create: `src/extraction/extraction.pipe`, `src/extraction/rocketride.ts`, `src/extraction/index.ts`, `src/ai/extract.ts`
- Test: `tests/extract-fallback.test.ts`, `tests/extract.integration.test.ts`

**Interfaces:**
- Consumes: `config`, `MockEmail`, `ExtractedEntities`, `chatJson` (Task 11).
- Produces: `extractWithButterbase(email): Promise<ExtractedEntities>` (in `src/ai/extract.ts`); `startExtractionPipeline()`, `stopExtractionPipeline()`, `extractWithRocketRide(email): Promise<ExtractedEntities>`, `rocketrideConfigured()` (in `src/extraction/rocketride.ts`); `extractEmailEntities(email): Promise<ExtractedEntities>` (in `src/extraction/index.ts`) — RocketRide when configured, Butterbase fallback on any error.

**Note:** Before writing `extraction.pipe`, read `.rocketride/docs/ROCKETRIDE_PIPELINE_RULES.md` + `ROCKETRIDE_COMPONENT_REFERENCE.md` for the exact `llm_openai_api` config fields. Generate a fresh GUID with `uuidgen` for `project_id`. `components` first.

- [ ] **Step 1: Implement the Butterbase fallback `src/ai/extract.ts`**

```ts
import { chatJson } from './gateway.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

const SYSTEM =
  'Extract structured travel entities from a single email. Respond ONLY with JSON matching: ' +
  '{"person":{"name","email"},"booking":{"pnr","airline"},' +
  '"flight":{"number","date","route","from","to","status","airline"},' +
  '"loyalty":{"program","number","airline"},"payment":{"brand","last4"},' +
  '"baggage":{"tag","damage"},"airports":[string]}. ' +
  'Omit fields you cannot find. NEVER include a full card number — only last4. ' +
  'date is ISO yyyy-mm-dd. status is one of confirmed|completed|canceled|unknown. ' +
  'from/to and airports use IATA codes (e.g. ICN, SFO). ' +
  'If the email is unrelated to air travel, return {}.';

export async function extractWithButterbase(email: MockEmail): Promise<ExtractedEntities> {
  return chatJson<ExtractedEntities>(SYSTEM,
    `From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`);
}
```

- [ ] **Step 2: Create `src/extraction/extraction.pipe`** (replace `PUT-A-FRESH-GUID-HERE` with `uuidgen` output)

```json
{
  "components": [
    { "id": "chat_1", "provider": "chat", "config": { "hideForm": true, "mode": "Source", "parameters": {}, "type": "chat" } },
    { "id": "llm_1", "provider": "llm_openai_api",
      "config": { "profile": "custom", "custom": { "apikey": "${ROCKETRIDE_BUTTERBASE_API_KEY}", "base_url": "${ROCKETRIDE_BUTTERBASE_BASE_URL}", "model": "${ROCKETRIDE_BUTTERBASE_MODEL}", "modelTotalTokens": 200000 } },
      "input": [{ "lane": "questions", "from": "chat_1" }] },
    { "id": "response_1", "provider": "response_answers", "config": {}, "input": [{ "lane": "answers", "from": "llm_1" }] }
  ],
  "project_id": "PUT-A-FRESH-GUID-HERE",
  "source": "chat_1",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "version": 1
}
```

- [ ] **Step 3: Implement `src/extraction/rocketride.ts`**

```ts
import { RocketRideClient, Question } from 'rocketride';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

let client: RocketRideClient | null = null;
let token: string | null = null;

const PIPE = new URL('./extraction.pipe', import.meta.url).pathname;

export function rocketrideConfigured(): boolean { return config.rocketride.configured; }

export async function startExtractionPipeline(): Promise<void> {
  // .pipe substitution only accepts ${ROCKETRIDE_*}; map the Butterbase gateway values in.
  process.env.ROCKETRIDE_BUTTERBASE_API_KEY = config.butterbase.apiKey;
  process.env.ROCKETRIDE_BUTTERBASE_BASE_URL = config.butterbase.llmBaseUrl;
  process.env.ROCKETRIDE_BUTTERBASE_MODEL = config.butterbase.model;
  client = new RocketRideClient(); // reads ROCKETRIDE_URI / ROCKETRIDE_APIKEY from .env
  await client.connect();
  const res = await client.use({ filepath: PIPE, useExisting: true });
  token = res.token;
  logger.info('rocketride: extraction pipeline ready', { token });
}

export async function stopExtractionPipeline(): Promise<void> {
  if (client) { await client.disconnect(); client = null; token = null; }
}

export async function extractWithRocketRide(email: MockEmail): Promise<ExtractedEntities> {
  if (!client || !token) throw new Error('rocketride pipeline not started');
  const q = new Question({ expectJson: true });
  q.addInstruction('Task', 'Extract structured travel entities from the email. Omit unknown fields. Only last4 for payment. Include baggage {tag,damage} if present.');
  q.addExample('Asiana confirmation email',
    { person: { name: 'Steven Yang' }, booking: { pnr: 'XKRF2M', airline: 'Asiana Airlines' },
      flight: { number: 'OZ212', date: '2026-07-03', route: 'ICN → SFO', from: 'ICN', to: 'SFO', status: 'completed' } });
  q.addContext(`From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`);
  q.addQuestion('Return the entities as JSON.');
  const resp = await client.chat({ token, question: q });
  const first = resp.answers?.[0];
  if (first === undefined || first === null) throw new Error('rocketride: empty answer');
  return (typeof first === 'string' ? JSON.parse(first) : first) as ExtractedEntities;
}
```

- [ ] **Step 4: Implement `src/extraction/index.ts`**

```ts
import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';
import { extractWithButterbase } from '../ai/extract.js';
import { extractWithRocketRide, rocketrideConfigured } from './rocketride.js';

export async function extractEmailEntities(email: MockEmail): Promise<ExtractedEntities> {
  if (rocketrideConfigured()) {
    try { return await extractWithRocketRide(email); }
    catch (e) { logger.warn('rocketride extract failed, falling back to butterbase', { id: email.id, error: String(e) }); }
  }
  return extractWithButterbase(email);
}
```

- [ ] **Step 5: Write the fallback unit test `tests/extract-fallback.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/extraction/rocketride.js', () => ({
  rocketrideConfigured: () => false,
  extractWithRocketRide: vi.fn(),
}));
vi.mock('../src/ai/extract.js', () => ({
  extractWithButterbase: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })),
}));

import { extractEmailEntities } from '../src/extraction/index.js';
import { extractWithButterbase } from '../src/ai/extract.js';

describe('extractEmailEntities', () => {
  it('uses Butterbase when RocketRide is not configured', async () => {
    const out = await extractEmailEntities({ id: 'x', from: '', to: '', subject: '', date: '', body: '' });
    expect(out.booking?.pnr).toBe('XKRF2M');
    expect(extractWithButterbase).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: Run fallback test**

Run: `npx vitest run tests/extract-fallback.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Write the integration test `tests/extract.integration.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { config } from '../src/config.js';
import { startExtractionPipeline, extractWithRocketRide, stopExtractionPipeline } from '../src/extraction/rocketride.js';

const run = config.rocketride.configured ? describe : describe.skip;
afterAll(async () => { await stopExtractionPipeline(); });

run('rocketride extraction (live)', () => {
  it('extracts booking + flight from the Asiana confirmation', async () => {
    await startExtractionPipeline();
    const out = await extractWithRocketRide({
      id: 'em-asiana-conf', from: 'no-reply@flyasiana.com', to: 'steven@example.com',
      subject: 'Your Asiana booking is confirmed — XKRF2M', date: '2026-06-15T09:00:00Z',
      body: 'Confirmation XKRF2M. Flight OZ212 from Seoul Incheon (ICN) to San Francisco (SFO) on July 3, 2026. Passenger: Steven Yang.' });
    expect(out.booking?.pnr).toBe('XKRF2M');
    expect(out.flight?.number).toBe('OZ212');
  });
});
```

- [ ] **Step 8: Run integration test**

Run: `npx vitest run tests/extract.integration.test.ts`
Expected: PASS with live RocketRide creds; SKIPPED otherwise. If it fails on pipeline shape, apply PIPELINE_RULES/COMPONENT_REFERENCE fixes to `extraction.pipe` and re-run.

- [ ] **Step 9: Commit**

```bash
git add src/extraction/ src/ai/extract.ts tests/extract-fallback.test.ts tests/extract.integration.test.ts
git commit -m "feat: RocketRide extraction (Butterbase-gateway LLM) + fallback"
```

---

### Task 14: Orchestrator (timeline + state machine)

**Files:**
- Create: `src/orchestrator/timeline.ts`, `src/orchestrator/machine.ts`, `src/demo/fallback.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3), `SseHub` (Task 5), `ingestEmail`/`DEMO_USER_ID` (Task 7), `getGraph`/`assembleBriefing` (Task 8), `neo4jConfigured` (Task 6), `assembleCard` (Task 9), `MOCK_INBOX` (Task 10), `detectCompanyIntent` (Task 11), `decideIvrAction` (Task 11), `getIvrContext` (Task 12), `extractEmailEntities` (Task 13).
- Produces: `ASIANA_IVR_SCRIPT: { prompt: string }[]`; `runSession(deps, sessionId): Promise<void>` where `deps = { db, hub, stepMs?, holdMs? }`. Emits SSE **coarse** events (`status`, `graph`, `ivr`, `briefing`, `reasoning`) in the exact frontend shapes, advances `sessions.status` up to `on_hold`, then STOPS (frontend owns handoff).
- Produces: `FALLBACK_GRAPH: GraphData`, `FALLBACK_CARD: BriefingCard` in `src/demo/fallback.ts`.

- [ ] **Step 1: Implement `src/orchestrator/timeline.ts`**

```ts
export const DEMO_STEP_MS = 700;   // delay between graph drips
export const HOLD_MS = 3000;

// The 5 recorded Asiana IVR beats (matched to asiana_phone_call.m4a).
export const ASIANA_IVR_SCRIPT: { prompt: string }[] = [
  { prompt: 'For assistance in English, please press number 2.' },
  { prompt: 'For arrival and departure info press 1, flight schedule press 2, Asiana Club press 3, reservation and ticketing press 4, to speak to an agent press 5.' },
  { prompt: 'For U.S. departures or arrival baggage info press 1, seat assignment press 2, unaccompanied minor or pets press 3, contact numbers press 4, internet support press 5, all other inquiries press 6.' },
  { prompt: 'Please enter your Asiana Club membership number, followed by the star sign. If you are not a member, please press the pound key.' },
  { prompt: 'Due to the heavy volume of incoming calls, the estimated wait time is more than 5 minutes.' },
];
```

- [ ] **Step 2: Implement `src/demo/fallback.ts`**

```ts
import type { GraphData, BriefingCard } from '../types.js';

export const FALLBACK_CARD: BriefingCard = {
  company: 'Asiana Airlines', user_intent: 'File baggage damage claim',
  identity: { name: 'Steven Yang', loyalty_program: 'Asiana Club', loyalty_number: '920384712' },
  booking: { pnr: 'XKRF2M', flight_number: 'OZ212', route: 'ICN → SFO', date: '2026-07-03', status: 'completed' },
  payment: { brand: 'American Express', last4: '1087' },
  context: { user_location: 'San Francisco', urgency: 'Suitcase broken on arrival — need damage claim filed within 7 days' },
  suggested_opening:
    'Hi, I flew on Asiana flight OZ212 from Seoul Incheon to San Francisco on July 3rd, booking reference XKRF2M. ' +
    'My checked suitcase was damaged during the flight — the handle is broken and there is a crack along the shell. ' +
    'My baggage tag number is 0988-7234. I need to file a damage claim. My Asiana Club number is 920384712.',
};

export const FALLBACK_GRAPH: GraphData = {
  nodes: [
    { id: 'Person:steven-yang', type: 'Person', label: 'Steven Yang' },
    { id: 'Booking:XKRF2M', type: 'Booking', label: 'XKRF2M' },
    { id: 'Flight:OZ212', type: 'Flight', label: 'OZ212 ICN→SFO' },
    { id: 'Airline:Asiana', type: 'Airline', label: 'Asiana Airlines' },
    { id: 'LoyaltyAccount:920384712', type: 'LoyaltyAccount', label: 'Asiana Club #920384712' },
    { id: 'PaymentMethod:amex-1087', type: 'PaymentMethod', label: 'Amex ••1087' },
    { id: 'Airport:ICN', type: 'Airport', label: 'ICN' },
    { id: 'Airport:SFO', type: 'Airport', label: 'SFO' },
    { id: 'Attachment:0988-7234', type: 'Attachment', label: 'Baggage Tag #0988-7234' },
  ],
  edges: [
    { id: 'e1', source: 'Person:steven-yang', target: 'Booking:XKRF2M', type: 'HAS_BOOKING' },
    { id: 'e2', source: 'Booking:XKRF2M', target: 'Flight:OZ212', type: 'INCLUDES' },
    { id: 'e3', source: 'Flight:OZ212', target: 'Airline:Asiana', type: 'OPERATED_BY' },
    { id: 'e4', source: 'Person:steven-yang', target: 'LoyaltyAccount:920384712', type: 'HAS_LOYALTY' },
    { id: 'e5', source: 'Booking:XKRF2M', target: 'PaymentMethod:amex-1087', type: 'PAID_WITH' },
    { id: 'e6', source: 'Flight:OZ212', target: 'Airport:ICN', type: 'DEPARTS_FROM' },
    { id: 'e7', source: 'Flight:OZ212', target: 'Airport:SFO', type: 'ARRIVES_AT' },
    { id: 'e8', source: 'Booking:XKRF2M', target: 'Attachment:0988-7234', type: 'HAS_BAGGAGE' },
  ],
};
```

- [ ] **Step 3: Write the failing test `tests/orchestrator.test.ts`**

Injects fakes for every dependency so it runs offline; asserts the coarse SSE event shapes and status progression, and that the backend STOPS at `on_hold` (no handoff/done).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub, type SseEvent } from '../src/sse/hub.js';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'Asiana Airlines', intent: 'baggage_damage_claim' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'Press 5', reasoning: 'reach an agent' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'press 2 -> 5 -> 1 -> enter club -> hold') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({ DEMO_USER_ID: 'steven-yang', ingestEmail: vi.fn(async () => undefined) }));
vi.mock('../src/graph/query.js', () => ({
  getGraph: vi.fn(async () => ({ nodes: [{ id: 'Booking:XKRF2M', type: 'Booking', label: 'XKRF2M' }], edges: [] })),
  assembleBriefing: vi.fn(async () => ({ pnr: 'XKRF2M', flight_number: 'OZ212', route: 'ICN → SFO', status: 'completed', name: 'Steven Yang', loyalty_program: 'Asiana Club', loyalty_number: '920384712', payment_brand: 'American Express', payment_last4: '1087', baggage_tag: '0988-7234' })),
}));
vi.mock('../src/demo/inbox.js', () => ({ MOCK_INBOX: [
  { id: 'em1', from: 'asiana', to: 's', subject: 'conf XKRF2M', date: '2026-06-15', body: 'OZ212' },
], EXPECTED_DOSSIER: {} }));

import { runSession } from '../src/orchestrator/machine.js';

describe('runSession', () => {
  let db: ReturnType<typeof createMemoryDb>;
  let hub: ReturnType<typeof createSseHub>;
  let events: SseEvent[];

  beforeEach(() => { db = createMemoryDb(); hub = createSseHub(); events = []; });

  it('drives status to on_hold, emits coarse events, and does NOT emit handoff', async () => {
    const s = await db.createSession({ user_input: 'Asiana broke my suitcase, need a damage claim' });
    hub.subscribe(s.id, (e) => events.push(e));
    await runSession({ db, hub, stepMs: 0, holdMs: 0 }, s.id);

    const statuses = events.filter((e) => e.event === 'status').map((e) => (e.data as { status: string }).status);
    expect(statuses).toEqual(['dialing', 'navigating', 'on_hold']);

    // coarse event names only
    const names = new Set(events.map((e) => e.event));
    expect(names).toContain('graph');
    expect(names).toContain('ivr');
    expect(names).toContain('briefing');
    expect(names).toContain('reasoning');
    expect(names.has('handoff')).toBe(false);
    expect(names.has('done')).toBe(false);
    expect([...names].some((n) => n.includes('.'))).toBe(false); // no dotted events

    // graph event carries a full GraphData snapshot
    const graphEvt = events.find((e) => e.event === 'graph');
    expect(graphEvt && (graphEvt.data as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0);

    // ivr event carries the frontend IvrDecision shape
    const ivrEvt = events.find((e) => e.event === 'ivr');
    expect(ivrEvt && (ivrEvt.data as { prompt_text: string }).prompt_text).toBeTruthy();
    expect(ivrEvt && (ivrEvt.data as { timestamp: string }).timestamp).toBeTruthy();

    // briefing event carries the full card
    const brief = events.find((e) => e.event === 'briefing');
    expect(brief && (brief.data as { suggested_opening: string }).suggested_opening).toContain('OZ212');

    expect((await db.getSession(s.id))?.status).toBe('on_hold');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — cannot find `../src/orchestrator/machine.js`.

- [ ] **Step 5: Implement `src/orchestrator/machine.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/interface.js';
import type { SseHub } from '../sse/hub.js';
import type { BriefingCard, GraphData, IvrDecision, ReasoningEntry } from '../types.js';
import { logger } from '../logger.js';
import { MOCK_INBOX } from '../demo/inbox.js';
import { detectCompanyIntent } from '../ai/intent.js';
import { decideIvrAction } from '../ai/ivr.js';
import { getIvrContext } from '../rag/query.js';
import { extractEmailEntities } from '../extraction/index.js';
import { ingestEmail, DEMO_USER_ID } from '../graph/ingest.js';
import { getGraph, assembleBriefing } from '../graph/query.js';
import { neo4jConfigured } from '../graph/neo4j.js';
import { assembleCard } from '../briefing/assemble.js';
import { ASIANA_IVR_SCRIPT } from './timeline.js';
import { FALLBACK_GRAPH, FALLBACK_CARD } from '../demo/fallback.js';

export interface RunDeps { db: Db; hub: SseHub; stepMs?: number; holdMs?: number; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSession(deps: RunDeps, sessionId: string): Promise<void> {
  const { db, hub } = deps;
  const stepMs = deps.stepMs ?? 700;
  const holdMs = deps.holdMs ?? 3000;

  const session = await db.getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const reason = async (type: ReasoningEntry['type'], message: string) => {
    const row = await db.addReasoning({ session_id: sessionId, phase: type, message });
    const entry: ReasoningEntry = { id: row.id, message, timestamp: row.created_at, type };
    hub.publish(sessionId, 'reasoning', entry);
  };
  const setStatus = async (status: string) => {
    await db.updateSession(sessionId, { status: status as never });
    hub.publish(sessionId, 'status', { status });
  };
  const emitGraph = async () => {
    let g: GraphData;
    try { g = neo4jConfigured() ? await getGraph() : FALLBACK_GRAPH; }
    catch { g = FALLBACK_GRAPH; }
    hub.publish(sessionId, 'graph', g);
  };

  try {
    // 1. intent
    let company = 'Asiana Airlines', intent = 'baggage_damage_claim';
    try { const r = await detectCompanyIntent(session.user_input); company = r.company; intent = r.intent; }
    catch (e) { logger.warn('intent detection failed, using defaults', { error: String(e) }); }
    await db.updateSession(sessionId, { detected_company: company, detected_intent: intent });
    await reason('info', `Identified company: ${company}. Intent: ${intent.replace(/_/g, ' ')}.`);

    // 2. extraction → graph (drip full snapshots)
    for (const email of MOCK_INBOX) {
      try {
        const entities = await extractEmailEntities(email);
        if (neo4jConfigured()) await ingestEmail(DEMO_USER_ID, email, entities);
        const hasSignal = entities.booking || entities.flight || entities.loyalty || entities.payment || entities.baggage;
        if (hasSignal) {
          await emitGraph();
          const label = entities.booking?.pnr ?? entities.flight?.number ?? entities.loyalty?.number ?? entities.baggage?.tag ?? email.subject;
          await reason('extraction', `Extracted from "${email.subject}": ${label}`);
        }
      } catch (e) { logger.warn('extract/ingest failed for email', { id: email.id, error: String(e) }); }
      await sleep(stepMs);
    }
    await emitGraph(); // final full snapshot

    // 3. dial + navigate
    await setStatus('dialing');
    await reason('info', `Dialing ${company} customer service.`);
    await sleep(stepMs);
    await setStatus('navigating');
    const ragContext = await getIvrContext('How do I reach an Asiana agent to file a baggage damage claim?');
    for (const beat of ASIANA_IVR_SCRIPT) {
      let decision = 'Press 5', reasoning = 'Reach a human agent';
      try { const d = await decideIvrAction(beat.prompt, ragContext); decision = d.decision; reasoning = d.reasoning; }
      catch (e) { logger.warn('ivr decision failed, using default', { error: String(e) }); }
      const row = await db.addIvrDecision({ session_id: sessionId, prompt_text: beat.prompt, decision, reasoning });
      const ivr: IvrDecision = { id: row.id, prompt_text: beat.prompt, decision, reasoning, timestamp: row.created_at };
      hub.publish(sessionId, 'ivr', ivr);
      await reason('decision', `IVR: ${decision} — ${reasoning}`);
      await sleep(stepMs);
    }

    // 4. hold + briefing assembly
    await setStatus('on_hold');
    await reason('info', 'On hold. Assembling briefing card from graph...');
    let card: BriefingCard;
    try {
      const dossier = neo4jConfigured() ? await assembleBriefing(DEMO_USER_ID) : null;
      card = assembleCard(dossier, { company, intent: 'File baggage damage claim', location: 'San Francisco', urgency: 'Suitcase broken on arrival — need damage claim filed within 7 days' });
      if (!card.booking.pnr) card = FALLBACK_CARD; // demo safety
    } catch (e) {
      logger.warn('briefing assembly failed, using fallback card', { error: String(e) });
      card = FALLBACK_CARD;
    }
    await db.saveBriefingCard(sessionId, card, card.suggested_opening);
    hub.publish(sessionId, 'briefing', card);
    await sleep(holdMs);
    // STOP here — the frontend fires the handoff when the recorded audio ends.
  } catch (e) {
    logger.error('runSession fatal', { sessionId, error: String(e) });
    const entry: ReasoningEntry = { id: randomUUID(), message: `Error: ${String(e)}`, timestamp: new Date().toISOString(), type: 'error' };
    hub.publish(sessionId, 'reasoning', entry);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/ src/demo/fallback.ts tests/orchestrator.test.ts
git commit -m "feat: orchestrator (coarse SSE, Asiana IVR, frontend-owned handoff)"
```

---

### Task 15: Routes + server wiring (frontend contract)

**Files:**
- Create: `src/routes/sessions.ts`, `src/server.ts`
- Test: `tests/routes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildServer(deps: { db, hub }): FastifyInstance`. Endpoints: `POST /sessions` (returns full `Session`), `GET /sessions/:id`, `GET /sessions/:id/stream` (SSE), plus optional recovery snapshots `GET /sessions/:id/graph|ivr-log|briefing|reasoning|audio`. `src/server.ts` boots it.

- [ ] **Step 1: Write the failing test `tests/routes.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/orchestrator/machine.js', () => ({
  runSession: vi.fn(async (deps: { hub: { publish: (s: string, e: string, d: unknown) => void } }, id: string) => {
    deps.hub.publish(id, 'status', { status: 'on_hold' });
  }),
}));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn() }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('routes', () => {
  it('POST /sessions returns the full Session (with id, not session_id)', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'asiana suitcase' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.session_id).toBeUndefined();
    expect(body.status).toBe('extracting');
    expect(body.user_input).toBe('asiana suitcase');
    await app.close();
  });

  it('GET /sessions/:id returns the row; 404 for unknown', async () => {
    const db = createMemoryDb();
    const app = buildServer({ db, hub: createSseHub() });
    const s = await db.createSession({ user_input: 'x' });
    expect((await app.inject({ method: 'GET', url: `/sessions/${s.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/sessions/nope' })).statusCode).toBe(404);
    await app.close();
  });

  it('GET /sessions/:id/briefing 404s before assembly', async () => {
    const db = createMemoryDb();
    const app = buildServer({ db, hub: createSseHub() });
    const s = await db.createSession({ user_input: 'x' });
    expect((await app.inject({ method: 'GET', url: `/sessions/${s.id}/briefing` })).statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/routes.test.ts`
Expected: FAIL — cannot find `../src/routes/sessions.js`.

- [ ] **Step 3: Implement `src/routes/sessions.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/interface.js';
import type { SseHub } from '../sse/hub.js';
import { config } from '../config.js';
import { runSession } from '../orchestrator/machine.js';
import { getGraph } from '../graph/query.js';
import { neo4jConfigured } from '../graph/neo4j.js';
import { FALLBACK_GRAPH } from '../demo/fallback.js';

export interface ServerDeps { db: Db; hub: SseHub; }

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, hub } = deps;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') reply.send();
  });

  // POST /sessions — returns the FULL Session (frontend casts to Session, uses .id)
  app.post<{ Body: { user_input: string } }>('/sessions', async (req, reply) => {
    const { user_input } = req.body ?? {};
    if (!user_input) return reply.code(400).send({ error: 'user_input required' });
    const s = await db.createSession({ user_input });
    void runSession({ db, hub }, s.id); // fire-and-forget orchestration
    return reply.code(201).send(s);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = await db.getSession(req.params.id);
    return s ? reply.send(s) : reply.code(404).send({ error: 'not found' });
  });

  // SSE stream — event names match the frontend: status, graph, ivr, briefing, reasoning
  app.get<{ Params: { id: string } }>('/sessions/:id/stream', (req, reply) => {
    const id = req.params.id;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': config.corsOrigin,
    });
    const write = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of hub.replayBuffer(id)) write(e.event, e.data);   // catch up
    const off = hub.subscribe(id, (e) => write(e.event, e.data));    // live
    req.raw.on('close', () => off());
  });

  // ---- Optional recovery snapshots (frontend uses POST + /stream; these aid recovery) ----
  app.get('/sessions/:id/graph', async (_req, reply) => {
    try { return reply.send(neo4jConfigured() ? await getGraph() : FALLBACK_GRAPH); }
    catch { return reply.send(FALLBACK_GRAPH); }
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/ivr-log', async (req, reply) => {
    const rows = await db.listIvrDecisions(req.params.id);
    return reply.send(rows.map((r) => ({ id: r.id, prompt_text: r.prompt_text, decision: r.decision, reasoning: r.reasoning, timestamp: r.created_at })));
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/reasoning', async (req, reply) => {
    const rows = await db.listReasoning(req.params.id);
    return reply.send(rows.map((r) => ({ id: r.id, message: r.message, timestamp: r.created_at, type: r.phase })));
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/briefing', async (req, reply) => {
    const card = await db.getBriefingCard(req.params.id);
    return card ? reply.send(card.card_json) : reply.code(404).send({ error: 'not ready' });
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/audio', async (_req, reply) => {
    return reply.send({ url: config.recordedAudioObjectId || '/asiana_phone_call.m4a' });
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `src/server.ts`**

```ts
import { config } from './config.js';
import { logger } from './logger.js';
import { createDb } from './db/index.js';
import { createSseHub } from './sse/hub.js';
import { buildServer } from './routes/sessions.js';
import { neo4jConfigured, initSchema } from './graph/neo4j.js';
import { rocketrideConfigured, startExtractionPipeline } from './extraction/rocketride.js';

async function main() {
  if (neo4jConfigured()) {
    try { await initSchema(); logger.info('neo4j schema ready'); }
    catch (e) { logger.error('neo4j schema init failed', { error: String(e) }); }
  }
  if (rocketrideConfigured()) {
    try { await startExtractionPipeline(); }
    catch (e) { logger.error('rocketride pipeline start failed (will fall back to Butterbase)', { error: String(e) }); }
  }
  const app = buildServer({ db: createDb(), hub: createSseHub() });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('BlackBox backend listening', { port: config.port });
}
main().catch((e) => { logger.error('startup failed', { error: String(e) }); process.exit(1); });
```

- [ ] **Step 6: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sessions.ts src/server.ts tests/routes.test.ts
git commit -m "feat: REST + SSE routes (frontend contract) and server wiring"
```

---

### Task 16: End-to-end smoke + README

**Files:**
- Create: `tests/e2e.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildServer`, memory db, sse hub, real `runSession` (externals mocked so it runs offline).

- [ ] **Step 1: Write `tests/e2e.test.ts`** (offline; proves complaint → briefing available with Asiana data)

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'Asiana Airlines', intent: 'baggage_damage_claim' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'Press 5', reasoning: 'r' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'ctx') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({ DEMO_USER_ID: 'steven-yang', ingestEmail: vi.fn(async () => undefined) }));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn(async () => null) }));
vi.mock('../src/demo/inbox.js', () => ({ MOCK_INBOX: [{ id: 'em1', from: 'a', to: 's', subject: 'XKRF2M', date: '2026-06-15', body: 'OZ212' }], EXPECTED_DOSSIER: {} }));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('e2e (offline)', () => {
  it('complaint → orchestration → Asiana briefing available', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'Asiana broke my suitcase' } });
    const { id } = res.json();

    let card = null;
    for (let i = 0; i < 60 && !card; i++) {
      const b = await app.inject({ method: 'GET', url: `/sessions/${id}/briefing` });
      if (b.statusCode === 200) card = b.json();
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(card).toBeTruthy();
    expect(card.company).toBe('Asiana Airlines');
    expect(card.suggested_opening).toContain('OZ212');
    await app.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all unit tests PASS; integration tests PASS or SKIP depending on creds present. No failures.

- [ ] **Step 4: Create `README.md`**

```markdown
# BlackBox Backend

AI-concierge backend: complaint → Neo4j identity graph → briefing card, streamed live over SSE.
Demo scenario: **Asiana baggage damage claim** (matches `frontend/` + `asiana_phone_call.m4a`).
See `docs/superpowers/specs/2026-07-07-blackbox-backend-design.md`.

## Run
1. `npm install`
2. Fill `.env` (copy from `.env.example`). Neo4j password + Butterbase key give the full path; the service still boots without them (in-memory + fallbacks).
3. `npm run seed:rag` (once, populates the Asiana RAG corpus)
4. `npm start` → http://localhost:8000

## Frontend contract
- `POST /sessions` `{user_input}` → full `Session` `{id, user_input, detected_company, detected_intent, status, created_at}`
- `GET /sessions/:id/stream` — SSE events: `status`, `graph`, `ivr`, `briefing`, `reasoning` (handoff is fired by the frontend when the audio ends)
- Recovery snapshots: `GET /sessions/:id` · `/graph` · `/ivr-log` · `/reasoning` · `/briefing` · `/audio`

## Test
`npm test` — unit tests always run; integration tests self-skip when their creds are absent.
```

- [ ] **Step 5: Manual smoke (optional, needs `.env` + running frontend)**

Run: `npm start`, then `curl -s -X POST localhost:8000/sessions -H 'Content-Type: application/json' -d '{"user_input":"Asiana broke my suitcase, I need a damage claim"}'`; grab the `id`, then `curl -N localhost:8000/sessions/<id>/stream` and watch `status`/`graph`/`ivr`/`briefing` events flow through to `on_hold`.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e.test.ts README.md
git commit -m "test: offline e2e + README"
```

---

## Self-Review

**Spec/contract coverage:**
- Frontend contract (port 8000, `/stream`, coarse events, `source`/`target`, `Session.id`, no backend handoff) → Global Constraints + Tasks 2, 14, 15. ✅
- Asiana scenario data (Steven Yang, OZ212/XKRF2M, Asiana Club 920384712, Amex 1087, baggage tag 0988-7234) → Tasks 8, 9, 10, 14 (fallback). ✅
- Complaint→intent (Asiana, baggage_damage_claim) → Task 11; extraction→graph → Tasks 7/13; briefing dossier (completed flight + baggage) → Task 8; card + opening → Task 9; RAG/IVR (Asiana) → Tasks 11/12; orchestration/IVR script → Task 14. ✅
- Butterbase tables via adapter → Tasks 3/4. Neo4j schema (+ Attachment) → Tasks 6/8. ✅
- Demo safety (in-memory fallback, OPTIONAL MATCH, seeded Asiana fallback graph/card) → Tasks 4/8/14. ✅
- Three sponsors load-bearing: RocketRide extraction via Butterbase gateway (13), Butterbase db/AI/RAG (4/11/12), Neo4j graph (6–8). ✅

**Placeholder scan:** `extraction.pipe` `project_id` (`uuidgen`, Task 13 Step 2) and the RAG REST path (Task 12, confirm vs docs) are the two intentional implementation-time confirmations. No other TBDs.

**Type consistency:** `Session/GraphNode/GraphEdge(source,target)/GraphData/IvrDecision/ReasoningEntry/BriefingCard` match `frontend/src/types/index.ts` verbatim. `Db`, `SseHub`/`SseEvent`, `ExtractedEntities` (with `baggage`), `BriefingDossier` (with `baggage_tag`), `runSession(deps, id)`, `assembleBriefing(userId)`, `assembleCard(dossier, ctx)`, `ASIANA_IVR_SCRIPT` are used identically across tasks.

## Notes for the implementer
- **Order matters:** Tasks 1→16 are dependency-ordered. Integration tests self-skip when creds are absent, so the plan runs green offline; wire real creds to flip them to PASS.
- **Two external blockers** (not blocking any task): correct `NEO4J_PASSWORD`; RocketRide API key + Butterbase LLM gateway env (`BUTTERBASE_API_KEY`/`BUTTERBASE_BASE_URL`/`BUTTERBASE_MODEL`).
- **Read before writing the `.pipe`:** `.rocketride/docs/ROCKETRIDE_PIPELINE_RULES.md` + `ROCKETRIDE_COMPONENT_REFERENCE.md` (Task 13) for the exact `llm_openai_api` config.
- **Frontend is the source of truth** for the API contract — if in doubt, read `frontend/src/hooks/useSession.ts` and `frontend/src/types/index.ts`.
```
