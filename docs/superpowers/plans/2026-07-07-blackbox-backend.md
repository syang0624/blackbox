# BlackBox Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BlackBox backend — a Fastify/TypeScript service that turns a user complaint into a live-assembled Neo4j identity graph and a briefing card, streaming every step to the frontend over SSE.

**Architecture:** Single Node/TS service on `PORT=4000`. Four modules behind clean seams (`db` = Butterbase Data API with in-memory fallback, `graph` = Neo4j, `extraction` = RocketRide pipeline with Butterbase-AI fallback, `ai` = Butterbase AI gateway) plus an in-process orchestrator state machine that drives a demo timeline and fans events out through an SSE hub. REST endpoints mirror the live state so the frontend can render or recover at any time.

**Tech Stack:** TypeScript (ESM, Node 20+), Fastify, `neo4j-driver`, `rocketride` SDK, native `fetch` for Butterbase, `vitest` for tests, `tsx` to run.

## Global Constraints

- Language/runtime: **TypeScript, ESM** (`"type": "module"`), **Node 20+**.
- Butterbase base URL `https://api.butterbase.ai`, app id `app_cyc857msb86y`, one app-scoped key in `BUTTERBASE_API_KEY` authenticates Data API **and** AI gateway.
- Butterbase AI model IDs are **provider-prefixed**: use `openai/gpt-4o-mini`.
- Butterbase Data API paths: `GET/POST /v1/{app_id}/{table}`, `PATCH/DELETE /v1/{app_id}/{table}/{id}`, filter `col=eq.value`, `order=col.desc`. Auth header `Authorization: Bearer {key}`.
- Butterbase AI path: `POST /v1/{app_id}/chat/completions` (OpenAI-compatible body/response).
- RocketRide: pipeline files use `.pipe` extension; `project_id` is a **literal GUID**; `components` first in the file; only `${ROCKETRIDE_*}`-prefixed env vars are substituted; start the pipeline **once** (`useExisting: true`) and reuse the token; **never block the event loop**; match `chat` source to `client.chat()`.
- Payment methods: store/display **only brand + last4**. Never extract or store a full PAN.
- Config values come from `.env` (already present, git-ignored). Never commit secrets.
- Every external call (Neo4j, Butterbase, RocketRide, LLM) is wrapped with a timeout + fallback; the service must boot and demo even if a dependency is down.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
src/
  config.ts                 # load + validate env, expose typed config
  types.ts                  # shared domain types (entities, graph, card, rows)
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
    ingest.ts               # ingestEmail(): MERGE entities → nodes/edges
    query.ts                # getGraph(), assembleBriefing()
  ai/
    gateway.ts              # chatJson(): Butterbase AI call → parsed JSON
    intent.ts               # detectCompanyIntent()
    ivr.ts                  # decideIvrAction()
  extraction/
    extraction.pipe         # RocketRide pipeline
    rocketride.ts           # RocketRide client wrapper
    index.ts                # extractEmailEntities() with fallback
  rag/
    query.ts                # getIvrContext() via Butterbase rag_query REST
  briefing/
    assemble.ts             # dossier → BriefingCard (pure)
  orchestrator/
    timeline.ts             # demo timeline constants + IVR script
    machine.ts              # runSession(): the state machine
  demo/
    inbox.ts                # ~15 mock email fixtures
    fallback.ts             # pre-baked graph + briefing for demo safety
  routes/
    sessions.ts             # REST + SSE endpoints
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
- Produces: `config` object with `{ port, corsOrigin, butterbase: { apiUrl, appId, apiKey, model, ragCollection }, neo4j: { uri, username, password, database }, rocketride: { uri, apikey }, recordedAudioObjectId, flags: { recordedDemo, realPhone } }`. Helper `parseConfig(env: Record<string,string|undefined>): Config`.
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
Expected: `node_modules/` created, no errors. (If `rocketride` version resolution fails, run `npm view rocketride version` and pin the printed version.)

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
  PORT: '4000', CORS_ORIGIN: 'http://localhost:3000',
  BUTTERBASE_API_URL: 'https://api.butterbase.ai', BUTTERBASE_APP_ID: 'app_x',
  BUTTERBASE_API_KEY: 'bb_sk_x', BUTTERBASE_AI_MODEL: 'openai/gpt-4o-mini',
  BUTTERBASE_RAG_COLLECTION: 'support-knowledge',
  NEO4J_URI: 'neo4j+s://x', NEO4J_USERNAME: 'neo4j', NEO4J_PASSWORD: 'p', NEO4J_DATABASE: 'neo4j',
};

describe('parseConfig', () => {
  it('parses a full env into typed config', () => {
    const c = parseConfig(base);
    expect(c.port).toBe(4000);
    expect(c.butterbase.appId).toBe('app_x');
    expect(c.butterbase.model).toBe('openai/gpt-4o-mini');
    expect(c.neo4j.database).toBe('neo4j');
  });

  it('detects placeholder Butterbase creds as not-configured', () => {
    const c = parseConfig({ ...base, BUTTERBASE_API_KEY: 'your_butterbase_server_api_key' });
    expect(c.butterbase.configured).toBe(false);
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
    apiUrl: string; appId: string; apiKey: string; model: string;
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
    port: Number(env.PORT ?? 4000),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3000',
    butterbase: {
      apiUrl: env.BUTTERBASE_API_URL ?? 'https://api.butterbase.ai',
      appId: env.BUTTERBASE_APP_ID ?? '',
      apiKey: bbKey,
      model: env.BUTTERBASE_AI_MODEL ?? 'openai/gpt-4o-mini',
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
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/logger.ts src/config.ts tests/config.test.ts
git commit -m "chore: scaffold backend + typed config"
```

---

### Task 2: Shared domain types

**Files:**
- Create: `src/types.ts`
- Test: none (type-only module; consumed and compiled by later tasks).

**Interfaces:**
- Produces: `ExtractedEntities`, `GraphNode`, `GraphEdge`, `GraphData`, `BriefingDossier`, `BriefingCard`, `MockEmail`.

- [ ] **Step 1: Create `src/types.ts`**

```ts
export interface MockEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;   // ISO
  body: string;
  forwarded_from?: string;
}

// One email's worth of extracted structured entities.
export interface ExtractedEntities {
  person?: { id?: string; name?: string; email?: string };
  booking?: { pnr?: string; airline?: string };
  flight?: {
    number?: string; date?: string; route?: string;
    from?: string; to?: string; status?: string; airline?: string;
  };
  loyalty?: { program?: string; number?: string; airline?: string };
  payment?: { brand?: string; last4?: string };
  airports?: string[];         // IATA codes mentioned
  companion?: { name?: string };
}

export interface GraphNode { id: string; type: string; label: string; props: Record<string, unknown>; }
export interface GraphEdge { id: string; from: string; to: string; type: string; }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }

// Raw dossier straight from the briefing Cypher query.
export interface BriefingDossier {
  name?: string; loyalty_program?: string; loyalty_number?: string;
  pnr?: string; flight_number?: string; route?: string; date?: string; status?: string;
  payment_brand?: string; payment_last4?: string;
}

// PRD §11 shape.
export interface BriefingCard {
  company: string;
  user_intent: string;
  identity: { name?: string; loyalty_program?: string; loyalty_number?: string };
  booking: { pnr?: string; flight_number?: string; route?: string; date?: string; status?: string };
  payment: { brand?: string; last4?: string };
  context: { user_location?: string; urgency?: string };
  suggested_opening: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared domain types"
```

---

### Task 3: Db interface + in-memory adapter

**Files:**
- Create: `src/db/interface.ts`, `src/db/memory.ts`
- Test: `tests/db-memory.test.ts`

**Interfaces:**
- Produces: row types `SessionRow`, `IvrDecisionRow`, `BriefingRow`, `ReasoningRow`; `Db` interface; `createMemoryDb(): Db`.
- Consumes: nothing.

- [ ] **Step 1: Create `src/db/interface.ts`**

```ts
export type SessionStatus =
  'extracting' | 'dialing' | 'navigating' | 'on_hold' | 'handoff' | 'done';

export interface SessionRow {
  id: string; user_id: string | null; user_input: string;
  detected_company: string | null; detected_intent: string | null;
  status: SessionStatus; created_at: string;
}
export interface IvrDecisionRow {
  id: string; session_id: string; prompt_text: string | null;
  decision: string | null; reasoning: string | null; created_at: string;
}
export interface BriefingRow {
  id: string; session_id: string; card_json: unknown;
  suggested_opening: string | null; created_at: string;
}
export interface ReasoningRow {
  id: string; session_id: string; phase: string | null;
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
    await db.updateSession(s.id, { status: 'on_hold', detected_company: 'United Airlines' });
    const got = await db.getSession(s.id);
    expect(got?.status).toBe('on_hold');
    expect(got?.detected_company).toBe('United Airlines');
  });

  it('appends and lists ivr decisions and reasoning', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.addIvrDecision({ session_id: s.id, prompt_text: 'Main menu', decision: 'press 1', reasoning: 'billing' });
    await db.addReasoning({ session_id: s.id, phase: 'extracting', message: 'found booking' });
    expect(await db.listIvrDecisions(s.id)).toHaveLength(1);
    expect(await db.listReasoning(s.id)).toHaveLength(1);
  });

  it('stores and returns a briefing card', async () => {
    const db = createMemoryDb();
    const s = await db.createSession({ user_input: 'x' });
    await db.saveBriefingCard(s.id, { company: 'United Airlines' }, 'Hi Sarah');
    const card = await db.getBriefingCard(s.id);
    expect((card?.card_json as { company: string }).company).toBe('United Airlines');
    expect(card?.suggested_opening).toBe('Hi Sarah');
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
        id: randomUUID(), user_id: null, user_input: input.user_input,
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
- Produces: `createButterbaseDb(cfg): Db`, `createDb(): Db` (returns Butterbase adapter when `config.butterbase.configured`, else memory adapter with a warning).

**Note:** The request/response shapes below are the ones verified live against `app_cyc857msb86y`: `POST .../sessions` → `201` with the row; `GET .../sessions?limit=1` → `[]`; `DELETE` → `{deleted:true}`.

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
      await req('POST', '/briefing_cards', {
        session_id: sessionId, card_json: cardJson, suggested_opening: suggestedOpening,
      });
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
    const s = await db.createSession({ user_input: 'integration test', detected_company: 'United Airlines' });
    expect(s.id).toBeTruthy();
    await db.updateSession(s.id, { status: 'on_hold' });
    expect((await db.getSession(s.id))?.status).toBe('on_hold');
    await db.addReasoning({ session_id: s.id, phase: 'extracting', message: 'hello' });
    expect((await db.listReasoning(s.id)).length).toBeGreaterThanOrEqual(1);
    await db.saveBriefingCard(s.id, { company: 'United Airlines' }, 'Hi');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run tests/db-butterbase.integration.test.ts`
Expected: PASS if `.env` has real Butterbase creds; SKIPPED otherwise. Both are acceptable green states.

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
    hub.publish('s1', 'graph.node', { id: 'n1' });
    expect(hub.replayBuffer('s1')).toEqual([{ event: 'graph.node', data: { id: 'n1' } }]);
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
- Consumes: `config` (Task 1).
- Produces: `getDriver()`, `runWrite(cypher, params)`, `runRead(cypher, params)`, `initSchema(): Promise<void>`, `closeDriver()`, `neo4jConfigured(): boolean`.

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
Expected: PASS once `NEO4J_PASSWORD` is correct; SKIPPED if not configured. (If it FAILS with `Neo.ClientError.Security.Unauthorized`, the password in `.env` is wrong — stop and fix it before continuing.)

- [ ] **Step 4: Commit**

```bash
git add src/graph/neo4j.ts tests/neo4j-connect.integration.test.ts
git commit -m "feat: neo4j driver + schema constraints"
```

---

### Task 7: Graph ingestion (entities → MERGE)

**Files:**
- Create: `src/graph/ingest.ts`
- Test: `tests/graph-ingest.integration.test.ts`

**Interfaces:**
- Consumes: `runWrite` (Task 6), `ExtractedEntities`, `GraphNode`, `GraphEdge` (Task 2).
- Produces: `ingestEmail(userId: string, email: MockEmail, entities: ExtractedEntities): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>` — returns the nodes/edges created or touched by this email (for SSE drip). `DEMO_USER_ID = 'jamie-chen'`.

- [ ] **Step 1: Write the integration test `tests/graph-ingest.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, runWrite, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => { await closeDriver(); });

const email: MockEmail = {
  id: 'test-conf-1', from: 'no-reply@united.com', to: 'jamie@example.com',
  subject: 'Confirmation ABC123', date: '2026-07-01T00:00:00Z', body: '...',
};

run('graph ingest (live)', () => {
  beforeAll(async () => {
    await initSchema();
    await runWrite('MATCH (n) WHERE n.id STARTS WITH "test-" OR n.pnr = "ZZ999" DETACH DELETE n');
  });

  it('creates booking+flight+person and links them', async () => {
    const out = await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Jamie Chen', email: 'jamie@example.com' },
      booking: { pnr: 'ZZ999', airline: 'United Airlines' },
      flight: { number: 'UA1234', date: '2026-07-07', route: 'SFO → ORD', from: 'SFO', to: 'ORD', status: 'canceled', airline: 'United Airlines' },
    });
    expect(out.nodes.some((n) => n.type === 'Booking' && n.props.pnr === 'ZZ999')).toBe(true);
    const linked = await runWrite<{ c: number }>(
      'MATCH (:Person {id:$u})-[:HAS_BOOKING]->(:Booking {pnr:"ZZ999"})-[:INCLUDES]->(:Flight {number:"UA1234"}) RETURN count(*) AS c',
      { u: DEMO_USER_ID });
    expect(Number(linked[0].c)).toBe(1);
  });

  it('is idempotent across repeated ingest of the same entities', async () => {
    await ingestEmail(DEMO_USER_ID, email, { booking: { pnr: 'ZZ999' } });
    const rows = await runWrite<{ c: number }>('MATCH (b:Booking {pnr:"ZZ999"}) RETURN count(b) AS c');
    expect(Number(rows[0].c)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-ingest.integration.test.ts`
Expected: FAIL — cannot find `../src/graph/ingest.js` (or SKIPPED if Neo4j not configured; if skipped, implement anyway and rely on Task 15 E2E).

- [ ] **Step 3: Implement `src/graph/ingest.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { runWrite } from './neo4j.js';
import type { ExtractedEntities, GraphNode, GraphEdge, MockEmail } from '../types.js';

export const DEMO_USER_ID = 'jamie-chen';

export async function ingestEmail(
  userId: string, email: MockEmail, e: ExtractedEntities,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const node = (type: string, label: string, props: Record<string, unknown>) => {
    nodes.push({ id: `${type}:${label}`, type, label, props });
  };
  const edge = (from: string, to: string, type: string) => {
    edges.push({ id: `${from}-${type}->${to}`, from, to, type });
  };

  // Email node (provenance)
  await runWrite('MERGE (e:Email {id:$id}) SET e.subject=$subject, e.date=$date, e.from=$from',
    { id: email.id, subject: email.subject, date: email.date, from: email.from });
  node('Email', email.id, { subject: email.subject });

  // Person
  const personId = e.person?.id ?? userId;
  await runWrite('MERGE (p:Person {id:$id}) SET p.name=coalesce($name, p.name), p.email=coalesce($email, p.email)',
    { id: personId, name: e.person?.name ?? null, email: e.person?.email ?? null });
  node('Person', personId, { name: e.person?.name });

  if (e.booking?.pnr) {
    await runWrite('MERGE (b:Booking {pnr:$pnr}) SET b.airline=coalesce($airline,b.airline)',
      { pnr: e.booking.pnr, airline: e.booking.airline ?? null });
    await runWrite('MATCH (p:Person {id:$u}),(b:Booking {pnr:$pnr}) MERGE (p)-[:HAS_BOOKING]->(b)',
      { u: personId, pnr: e.booking.pnr });
    node('Booking', e.booking.pnr, { pnr: e.booking.pnr });
    edge(`Person:${personId}`, `Booking:${e.booking.pnr}`, 'HAS_BOOKING');
  }

  if (e.flight?.number && e.flight?.date) {
    await runWrite(
      'MERGE (f:Flight {number:$n, date:$d}) SET f.route=$route, f.status=$status, f.airline=$airline, f.from=$from, f.to=$to',
      { n: e.flight.number, d: e.flight.date, route: e.flight.route ?? null, status: e.flight.status ?? null,
        airline: e.flight.airline ?? null, from: e.flight.from ?? null, to: e.flight.to ?? null });
    node('Flight', e.flight.number, { number: e.flight.number, status: e.flight.status, route: e.flight.route });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(f:Flight {number:$n,date:$d}) MERGE (b)-[:INCLUDES]->(f)',
        { pnr: e.booking.pnr, n: e.flight.number, d: e.flight.date });
      edge(`Booking:${e.booking.pnr}`, `Flight:${e.flight.number}`, 'INCLUDES');
    }
    for (const [code, rel] of [[e.flight.from, 'DEPARTS_FROM'], [e.flight.to, 'CONNECTED_TO']] as const) {
      if (code) {
        await runWrite('MERGE (a:Airport {code:$c})', { c: code });
        await runWrite(`MATCH (f:Flight {number:$n,date:$d}),(a:Airport {code:$c}) MERGE (f)-[:${rel}]->(a)`,
          { n: e.flight.number, d: e.flight.date, c: code });
        node('Airport', code, { code });
        edge(`Flight:${e.flight.number}`, `Airport:${code}`, rel);
      }
    }
  }

  if (e.loyalty?.number) {
    await runWrite('MERGE (l:LoyaltyAccount {number:$num}) SET l.program=$program, l.airline=$airline',
      { num: e.loyalty.number, program: e.loyalty.program ?? null, airline: e.loyalty.airline ?? null });
    await runWrite('MATCH (p:Person {id:$u}),(l:LoyaltyAccount {number:$num}) MERGE (p)-[:HAS_LOYALTY]->(l)',
      { u: personId, num: e.loyalty.number });
    node('LoyaltyAccount', e.loyalty.number, { number: e.loyalty.number, program: e.loyalty.program });
    edge(`Person:${personId}`, `LoyaltyAccount:${e.loyalty.number}`, 'HAS_LOYALTY');
  }

  if (e.payment?.last4) {
    const pkey = `${e.payment.brand ?? 'card'}-${e.payment.last4}`;
    await runWrite('MERGE (pm:PaymentMethod {key:$k}) SET pm.brand=$brand, pm.last4=$last4',
      { k: pkey, brand: e.payment.brand ?? null, last4: e.payment.last4 });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(pm:PaymentMethod {key:$k}) MERGE (b)-[:PAID_WITH]->(pm)',
        { pnr: e.booking.pnr, k: pkey });
      edge(`Booking:${e.booking.pnr}`, `PaymentMethod:${pkey}`, 'PAID_WITH');
    }
    node('PaymentMethod', pkey, { brand: e.payment.brand, last4: e.payment.last4 });
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-ingest.integration.test.ts`
Expected: PASS (2 tests) with live Neo4j; SKIPPED otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/graph/ingest.ts tests/graph-ingest.integration.test.ts
git commit -m "feat: neo4j entity ingestion (idempotent MERGE)"
```

---

### Task 8: Graph read + briefing dossier query

**Files:**
- Create: `src/graph/query.ts`
- Test: `tests/graph-query.integration.test.ts`

**Interfaces:**
- Consumes: `runRead` (Task 6), `GraphData`, `BriefingDossier` (Task 2).
- Produces: `getGraph(): Promise<GraphData>`, `assembleBriefing(userId: string): Promise<BriefingDossier | null>`.

- [ ] **Step 1: Write the integration test `tests/graph-query.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neo4jConfigured, initSchema, closeDriver } from '../src/graph/neo4j.js';
import { ingestEmail, DEMO_USER_ID } from '../src/graph/ingest.js';
import { getGraph, assembleBriefing } from '../src/graph/query.js';
import type { MockEmail } from '../src/types.js';

const run = neo4jConfigured() ? describe : describe.skip;
afterAll(async () => { await closeDriver(); });
const email: MockEmail = { id: 'test-q-1', from: 'x', to: 'y', subject: 's', date: '2026-07-01T00:00:00Z', body: '' };

run('graph query (live)', () => {
  beforeAll(async () => {
    await initSchema();
    await ingestEmail(DEMO_USER_ID, email, {
      person: { id: DEMO_USER_ID, name: 'Jamie Chen' },
      booking: { pnr: 'ABC123', airline: 'United Airlines' },
      flight: { number: 'UA1234', date: '2026-07-07', route: 'SFO → ORD', from: 'SFO', to: 'ORD', status: 'canceled', airline: 'United Airlines' },
      loyalty: { program: 'MileagePlus', number: '1234567', airline: 'United Airlines' },
      payment: { brand: 'Chase Sapphire Preferred', last4: '4242' },
    });
  });

  it('assembles the full dossier in one query', async () => {
    const d = await assembleBriefing(DEMO_USER_ID);
    expect(d?.pnr).toBe('ABC123');
    expect(d?.flight_number).toBe('UA1234');
    expect(d?.loyalty_number).toBe('1234567');
    expect(d?.payment_last4).toBe('4242');
  });

  it('returns nodes and edges for visualization', async () => {
    const g = await getGraph();
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.edges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-query.integration.test.ts`
Expected: FAIL — cannot find `../src/graph/query.js` (or SKIPPED).

- [ ] **Step 3: Implement `src/graph/query.ts`**

```ts
import { runRead } from './neo4j.js';
import type { GraphData, GraphNode, GraphEdge, BriefingDossier } from '../types.js';

export async function getGraph(): Promise<GraphData> {
  const nodeRows = await runRead<{ id: string; labels: string[]; props: Record<string, unknown> }>(
    'MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props');
  const edgeRows = await runRead<{ id: string; from: string; to: string; type: string }>(
    'MATCH (a)-[r]->(b) RETURN elementId(r) AS id, elementId(a) AS from, elementId(b) AS to, type(r) AS type');

  const nodes: GraphNode[] = nodeRows.map((r) => {
    const type = r.labels[0] ?? 'Node';
    const p = r.props as Record<string, unknown>;
    const label = (p.name ?? p.pnr ?? p.number ?? p.code ?? p.subject ?? p.brand ?? type) as string;
    return { id: r.id, type, label: String(label), props: p };
  });
  const edges: GraphEdge[] = edgeRows.map((r) => ({ id: r.id, from: r.from, to: r.to, type: r.type }));
  return { nodes, edges };
}

export async function assembleBriefing(userId: string): Promise<BriefingDossier | null> {
  const rows = await runRead<BriefingDossier>(
    `MATCH (u:Person {id:$user})-[:HAS_BOOKING]->(b:Booking)-[:INCLUDES]->(f:Flight {status:'canceled'})
     OPTIONAL MATCH (u)-[:HAS_LOYALTY]->(l:LoyaltyAccount)
       WHERE l.airline IS NULL OR f.airline IS NULL OR l.airline = f.airline
     OPTIONAL MATCH (b)-[:PAID_WITH]->(p:PaymentMethod)
     RETURN b.pnr AS pnr, f.number AS flight_number, f.date AS date, f.route AS route, f.status AS status,
            u.name AS name, l.program AS loyalty_program, l.number AS loyalty_number,
            p.brand AS payment_brand, p.last4 AS payment_last4
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
git commit -m "feat: graph read + one-query briefing dossier"
```

---

### Task 9: Briefing card assembly (pure)

**Files:**
- Create: `src/briefing/assemble.ts`
- Test: `tests/briefing-assemble.test.ts`

**Interfaces:**
- Consumes: `BriefingDossier`, `BriefingCard` (Task 2).
- Produces: `assembleCard(dossier: BriefingDossier | null, ctx: { company: string; intent: string; location: string; urgency: string }): BriefingCard`; `buildSuggestedOpening(card): string`.

- [ ] **Step 1: Write the failing test `tests/briefing-assemble.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleCard } from '../src/briefing/assemble.js';

const ctx = { company: 'United Airlines', intent: 'Rebook canceled flight', location: 'SFO airport', urgency: 'same-day rebooking needed' };

describe('assembleCard', () => {
  it('maps a full dossier into the PRD card shape with an opening line', () => {
    const card = assembleCard({
      pnr: 'ABC123', flight_number: 'UA1234', route: 'SFO → ORD', date: '2026-07-07', status: 'canceled',
      name: 'Jamie Chen', loyalty_program: 'MileagePlus', loyalty_number: '1234567',
      payment_brand: 'Chase Sapphire Preferred', payment_last4: '4242',
    }, ctx);
    expect(card.company).toBe('United Airlines');
    expect(card.booking.pnr).toBe('ABC123');
    expect(card.payment.last4).toBe('4242');
    expect(card.suggested_opening).toContain('ABC123');
    expect(card.suggested_opening).toContain('MileagePlus number is 1234567');
    expect(card.suggested_opening).toContain('ending 4242');
  });

  it('degrades gracefully on a partial/empty dossier', () => {
    const card = assembleCard(null, ctx);
    expect(card.company).toBe('United Airlines');
    expect(card.booking.pnr).toBeUndefined();
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

export function buildSuggestedOpening(c: BriefingCard): string {
  const parts: string[] = ['Hi,'];
  if (c.booking.pnr && c.booking.flight_number && c.booking.route) {
    parts.push(`I'm on booking ${c.booking.pnr}, flight ${c.booking.flight_number} from ${c.booking.route} today.`);
  } else if (c.booking.pnr) {
    parts.push(`I'm on booking ${c.booking.pnr}.`);
  }
  if (c.booking.status === 'canceled') parts.push('It was canceled — I need to rebook.');
  if (c.identity.loyalty_program && c.identity.loyalty_number) {
    parts.push(`My ${c.identity.loyalty_program} number is ${c.identity.loyalty_number}`);
  }
  if (c.payment.last4) {
    const tail = c.payment.brand ? ` and I paid with the ${c.payment.brand} ending ${c.payment.last4}.`
                                 : ` and I paid with the card ending ${c.payment.last4}.`;
    parts[parts.length - 1] = parts[parts.length - 1] + tail;
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
    identity: { name: d?.name, loyalty_program: d?.loyalty_program, loyalty_number: d?.loyalty_number },
    booking: { pnr: d?.pnr, flight_number: d?.flight_number, route: d?.route, date: d?.date, status: d?.status },
    payment: { brand: d?.payment_brand, last4: d?.payment_last4 },
    context: { user_location: ctx.location, urgency: ctx.urgency },
    suggested_opening: '',
  };
  card.suggested_opening = buildSuggestedOpening(card);
  return card;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/briefing-assemble.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/briefing/assemble.ts tests/briefing-assemble.test.ts
git commit -m "feat: briefing card assembly + suggested opening"
```

---

### Task 10: Mock inbox fixtures

**Files:**
- Create: `src/demo/inbox.ts`
- Test: `tests/inbox.test.ts`

**Interfaces:**
- Consumes: `MockEmail` (Task 2).
- Produces: `MOCK_INBOX: MockEmail[]` (~15 emails: United confirmation UA1234 SFO→ORD, Expedia forwarded itinerary, MileagePlus welcome 1234567, Chase statement ending 4242, cancellation notice, plus decoys). `EXPECTED_DOSSIER` constant for cross-checking the demo.

- [ ] **Step 1: Write the failing test `tests/inbox.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MOCK_INBOX } from '../src/demo/inbox.js';

describe('mock inbox', () => {
  it('has ~15 emails with unique ids', () => {
    expect(MOCK_INBOX.length).toBeGreaterThanOrEqual(12);
    expect(new Set(MOCK_INBOX.map((e) => e.id)).size).toBe(MOCK_INBOX.length);
  });
  it('contains the load-bearing United signal emails', () => {
    const bodies = MOCK_INBOX.map((e) => `${e.subject} ${e.body}`).join(' ');
    expect(bodies).toContain('UA1234');
    expect(bodies).toContain('ABC123');
    expect(bodies).toContain('1234567');   // MileagePlus
    expect(bodies).toContain('4242');       // Chase last4
    expect(bodies.toLowerCase()).toContain('cancel');
  });
  it('includes decoys (unrelated bookings) to force discrimination', () => {
    expect(MOCK_INBOX.some((e) => /delta|hotel|promo|amazon/i.test(`${e.subject} ${e.from}`))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inbox.test.ts`
Expected: FAIL — cannot find `../src/demo/inbox.js`.

- [ ] **Step 3: Implement `src/demo/inbox.ts`**

Write 15 `MockEmail` fixtures. Include, at minimum, these signal emails verbatim on the fields checked by the test, then fill the rest with realistic decoys.

```ts
import type { MockEmail } from '../types.js';

export const MOCK_INBOX: MockEmail[] = [
  { id: 'em-united-conf', from: 'confirmation@united.com', to: 'jamie@example.com',
    subject: 'Your United booking is confirmed — ABC123',
    date: '2026-06-20T15:04:00Z',
    body: 'Confirmation number ABC123. Flight UA1234 from SFO to ORD on July 7, 2026. Passenger: Jamie Chen.' },
  { id: 'em-expedia', from: 'itinerary@expedia.com', to: 'alex@example.com',
    subject: 'Fwd: Your trip to Chicago', date: '2026-06-20T16:10:00Z', forwarded_from: 'alex@example.com',
    body: 'Forwarded by your travel companion. United UA1234 SFO->ORD, confirmation ABC123 for Jamie Chen.' },
  { id: 'em-mileageplus', from: 'mileageplus@united.com', to: 'jamie@example.com',
    subject: 'Welcome to MileagePlus', date: '2025-01-11T09:00:00Z',
    body: 'Your MileagePlus number is 1234567. Start earning miles today.' },
  { id: 'em-chase', from: 'statements@chase.com', to: 'jamie@example.com',
    subject: 'Your Chase Sapphire Preferred statement', date: '2026-06-25T00:00:00Z',
    body: 'Card ending 4242. Recent charge: UNITED AIRLINES $412.30 on Jun 20.' },
  { id: 'em-cancel', from: 'no-reply@united.com', to: 'jamie@example.com',
    subject: 'Important: Your flight UA1234 has been canceled',
    date: '2026-07-06T23:30:00Z',
    body: 'We are sorry. Flight UA1234 (SFO to ORD) on July 7 was canceled due to weather. Please rebook.' },
  // --- decoys ---
  { id: 'em-delta-old', from: 'noreply@delta.com', to: 'jamie@example.com',
    subject: 'Delta itinerary DL55 — last year', date: '2025-03-02T00:00:00Z',
    body: 'Confirmation JKL999, Delta DL55 JFK->LAX. Unrelated old trip.' },
  { id: 'em-hotel', from: 'reservations@hilton.com', to: 'jamie@example.com',
    subject: 'Your Hilton reservation in Chicago', date: '2026-06-21T00:00:00Z',
    body: 'Reservation HIL777 for July 7-9. Not an airline booking.' },
  { id: 'em-promo-united', from: 'deals@united.com', to: 'jamie@example.com',
    subject: 'Weekend fare sale — save 30%', date: '2026-06-15T00:00:00Z',
    body: 'Promotional offer. No booking details.' },
  { id: 'em-amazon', from: 'ship-confirm@amazon.com', to: 'jamie@example.com',
    subject: 'Your Amazon order has shipped', date: '2026-06-30T00:00:00Z',
    body: 'Order 111-222 shipped. Card ending 9999.' },
  { id: 'em-newsletter', from: 'news@thepointsguy.com', to: 'jamie@example.com',
    subject: 'This week in points', date: '2026-07-01T00:00:00Z', body: 'Travel newsletter content.' },
  { id: 'em-uber', from: 'receipts@uber.com', to: 'jamie@example.com',
    subject: 'Your Tuesday trip receipt', date: '2026-07-05T00:00:00Z', body: 'Trip to SFO airport $38.40, card ending 4242.' },
  { id: 'em-spirit', from: 'noreply@spirit.com', to: 'jamie@example.com',
    subject: 'Spirit booking QWE111', date: '2024-11-01T00:00:00Z', body: 'Old Spirit trip, unrelated.' },
  { id: 'em-work', from: 'boss@example.com', to: 'jamie@example.com',
    subject: 'Re: Chicago client meeting July 7', date: '2026-07-02T00:00:00Z', body: 'Glad you land midday. See you at the office.' },
  { id: 'em-united-checkin', from: 'no-reply@united.com', to: 'jamie@example.com',
    subject: 'Check in for your flight', date: '2026-07-06T12:00:00Z',
    body: 'Check in now for UA1234 on July 7, confirmation ABC123.' },
  { id: 'em-bank-promo', from: 'offers@chase.com', to: 'jamie@example.com',
    subject: 'A new offer for you', date: '2026-06-10T00:00:00Z', body: 'Promotional. No statement details.' },
];

export const EXPECTED_DOSSIER = {
  pnr: 'ABC123', flight_number: 'UA1234', route: 'SFO → ORD',
  loyalty_number: '1234567', payment_last4: '4242',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inbox.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demo/inbox.ts tests/inbox.test.ts
git commit -m "feat: mock inbox fixtures with decoys"
```

---

### Task 11: Butterbase AI gateway (intent + IVR decisions)

**Files:**
- Create: `src/ai/gateway.ts`, `src/ai/intent.ts`, `src/ai/ivr.ts`
- Test: `tests/ai-parse.test.ts`, `tests/ai.integration.test.ts`

**Interfaces:**
- Consumes: `config` (Task 1).
- Produces: `chatJson<T>(system, user): Promise<T>` (calls Butterbase AI, strips code fences, `JSON.parse`); `extractJsonBlock(text): string`; `detectCompanyIntent(userInput): Promise<{ company: string; intent: string }>`; `decideIvrAction(promptText, ragContext): Promise<{ decision: string; reasoning: string }>`.

- [ ] **Step 1: Write the failing unit test `tests/ai-parse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { extractJsonBlock } from '../src/ai/gateway.js';

describe('extractJsonBlock', () => {
  it('strips ```json fences', () => {
    expect(JSON.parse(extractJsonBlock('```json\n{"a":1}\n```')).a).toBe(1);
  });
  it('returns bare json unchanged', () => {
    expect(JSON.parse(extractJsonBlock('{"b":2}')).b).toBe(2);
  });
  it('grabs the first object out of chatty text', () => {
    expect(JSON.parse(extractJsonBlock('Sure! {"c":3} hope that helps')).c).toBe(3);
  });
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
      temperature: 0, max_tokens: 400,
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
    'intent is a short snake_case slug like rebook_flight or refund_request.',
    userInput,
  );
}
```

- [ ] **Step 6: Implement `src/ai/ivr.ts`**

```ts
import { chatJson } from './gateway.js';

export async function decideIvrAction(promptText: string, ragContext: string): Promise<{ decision: string; reasoning: string }> {
  return chatJson(
    'You are navigating a phone IVR to reach a human agent for a flight rebooking. ' +
    'Given the IVR prompt and reference context, decide the single next action. ' +
    'Respond ONLY with JSON: {"decision": string, "reasoning": string}. ' +
    'decision is like "press 1", "press 0", or "say agent".',
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
  it('detects United + a rebooking intent from the demo complaint', async () => {
    const r = await detectCompanyIntent("I'm at SFO, my United flight to Chicago just got canceled and I need to rebook.");
    expect(r.company.toLowerCase()).toContain('united');
    expect(r.intent.toLowerCase()).toMatch(/rebook|flight|cancel/);
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

### Task 12: RAG seed + IVR context query

**Files:**
- Create: `src/rag/query.ts`, `src/seed/seed-rag.ts`
- Test: `tests/rag.integration.test.ts`

**Interfaces:**
- Consumes: `config` (Task 1).
- Produces: `getIvrContext(query: string): Promise<string>` (calls Butterbase `rag_query` REST with `synthesize:true`, returns the answer or joined chunks; returns `''` on failure). `seed-rag.ts` is a runnable script that ingests the United IVR map + policy into the `support-knowledge` collection.

**Note:** RAG REST endpoint path — confirm against `butterbase_docs` topic `rag`/`rest` at implementation time; the shape below (`POST /v1/{app_id}/rag/{collection}/query`) is the expected form. If the live call 404s, GET the docs and adjust the path, then re-run the integration test.

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
  } catch (e) {
    logger.warn('rag query error', { error: String(e) });
    return '';
  }
}
```

- [ ] **Step 2: Implement `src/seed/seed-rag.ts`**

```ts
import { config } from '../config.js';
import { logger } from '../logger.js';

const DOCS = [
  { title: 'united-ivr-map',
    text: 'United Airlines phone tree. To reach a human agent for an existing reservation or rebooking: ' +
          'at the main menu press 1 for reservations, then press 2 for existing reservations, then press 0, ' +
          'then say "agent" when the automated system asks how it can help. The path to a human is: 1 -> 2 -> 0 -> say "agent".' },
  { title: 'united-rebooking-policy',
    text: 'When a United flight is canceled due to weather, affected passengers may rebook on the next available flight ' +
          'at no additional charge. MileagePlus members and premium cabin passengers are prioritized. ' +
          'Have your confirmation number (PNR), flight number, and MileagePlus number ready.' },
  { title: 'united-weather-cancellation',
    text: 'Weather-related cancellations are outside airline control. United waives change fees and fare differences ' +
          'for rebooking within 24-48 hours on the same route. Refunds are available if the passenger chooses not to travel.' },
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
Expected: three "seeded rag doc" lines with 2xx statuses. If a 404/400 appears, GET `butterbase_docs` topic `rag` for the exact ingest path and fix `seed-rag.ts` + `query.ts`, then re-run. Wait ~30s for embedding (status goes pending → ready).

- [ ] **Step 4: Write the integration test `tests/rag.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
import { getIvrContext } from '../src/rag/query.js';

const run = config.butterbase.configured ? describe : describe.skip;

run('rag (live)', () => {
  it('retrieves the United path-to-human context', async () => {
    const ctx = await getIvrContext('How do I reach a human agent at United to rebook a canceled flight?');
    expect(ctx.toLowerCase()).toMatch(/agent|press|human|0/);
  });
});
```

- [ ] **Step 5: Run integration test**

Run: `npx vitest run tests/rag.integration.test.ts`
Expected: PASS after seeding; SKIPPED if unconfigured.

- [ ] **Step 6: Commit**

```bash
git add src/rag/query.ts src/seed/seed-rag.ts tests/rag.integration.test.ts
git commit -m "feat: RAG seed script + IVR context query"
```

---

### Task 13: RocketRide extraction with Butterbase fallback

**Files:**
- Create: `src/extraction/extraction.pipe`, `src/extraction/rocketride.ts`, `src/extraction/index.ts`, `src/ai/extract.ts`
- Test: `tests/extract-fallback.test.ts`, `tests/extract.integration.test.ts`

**Interfaces:**
- Consumes: `config`, `MockEmail`, `ExtractedEntities`, `chatJson` (Task 11).
- Produces: `extractWithButterbase(email): Promise<ExtractedEntities>` (fallback, in `src/ai/extract.ts`); `startExtractionPipeline(): Promise<void>` + `extractWithRocketRide(email): Promise<ExtractedEntities>` (in `src/extraction/rocketride.ts`); `extractEmailEntities(email): Promise<ExtractedEntities>` (in `src/extraction/index.ts`) — tries RocketRide when configured, falls back to Butterbase on any error.

**Note:** Before writing `extraction.pipe`, read `.rocketride/docs/ROCKETRIDE_PIPELINE_RULES.md` and `ROCKETRIDE_COMPONENT_REFERENCE.md` for the exact `llm` provider + config fields. Generate a fresh GUID for `project_id` with `uuidgen`. Keep `components` first (extension requirement).

- [ ] **Step 1: Implement the Butterbase fallback `src/ai/extract.ts`**

```ts
import { chatJson } from './gateway.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

const SYSTEM =
  'Extract structured travel entities from a single email. Respond ONLY with JSON matching: ' +
  '{"person":{"name","email"},"booking":{"pnr","airline"},' +
  '"flight":{"number","date","route","from","to","status","airline"},' +
  '"loyalty":{"program","number","airline"},"payment":{"brand","last4"},"airports":[string]}. ' +
  'Omit fields you cannot find. NEVER include a full card number — only last4. ' +
  'date is ISO yyyy-mm-dd. status is one of confirmed|canceled|unknown. ' +
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
    { "id": "llm_1", "provider": "llm_openai",
      "config": { "profile": "openai", "openai": { "apikey": "${ROCKETRIDE_OPENAI_KEY}", "model": "gpt-4o-mini", "modelTotalTokens": 16384 } },
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

export async function startExtractionPipeline(): Promise<void> {
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
  q.addInstruction('Task', 'Extract structured travel entities from the email. Omit unknown fields. Only last4 for payment.');
  q.addExample('United confirmation email',
    { person: { name: 'Jamie Chen' }, booking: { pnr: 'ABC123', airline: 'United Airlines' },
      flight: { number: 'UA1234', date: '2026-07-07', route: 'SFO → ORD', from: 'SFO', to: 'ORD', status: 'confirmed' } });
  q.addContext(`From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`);
  q.addQuestion('Return the entities as JSON.');
  const resp = await client.chat({ token, question: q });
  const first = resp.answers?.[0];
  if (!first) throw new Error('rocketride: empty answer');
  return (typeof first === 'string' ? JSON.parse(first) : first) as ExtractedEntities;
}

export function rocketrideConfigured(): boolean { return config.rocketride.configured; }
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
  extractWithButterbase: vi.fn(async () => ({ booking: { pnr: 'ABC123' } })),
}));

import { extractEmailEntities } from '../src/extraction/index.js';
import { extractWithButterbase } from '../src/ai/extract.js';

describe('extractEmailEntities', () => {
  it('uses Butterbase when RocketRide is not configured', async () => {
    const out = await extractEmailEntities({ id: 'x', from: '', to: '', subject: '', date: '', body: '' });
    expect(out.booking?.pnr).toBe('ABC123');
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
  it('extracts booking + flight from the United confirmation', async () => {
    await startExtractionPipeline();
    const out = await extractWithRocketRide({
      id: 'em-united-conf', from: 'confirmation@united.com', to: 'jamie@example.com',
      subject: 'Your United booking is confirmed — ABC123', date: '2026-06-20T15:04:00Z',
      body: 'Confirmation number ABC123. Flight UA1234 from SFO to ORD on July 7, 2026. Passenger: Jamie Chen.' });
    expect(out.booking?.pnr).toBe('ABC123');
    expect(out.flight?.number).toBe('UA1234');
  });
});
```

- [ ] **Step 8: Run integration test**

Run: `npx vitest run tests/extract.integration.test.ts`
Expected: PASS with live RocketRide creds; SKIPPED otherwise. (If it fails on pipeline shape, apply the PIPELINE_RULES/COMPONENT_REFERENCE fixes to `extraction.pipe` and re-run.)

- [ ] **Step 9: Commit**

```bash
git add src/extraction/ src/ai/extract.ts tests/extract-fallback.test.ts tests/extract.integration.test.ts
git commit -m "feat: RocketRide extraction pipeline + Butterbase fallback"
```

---

### Task 14: Orchestrator (timeline + state machine)

**Files:**
- Create: `src/orchestrator/timeline.ts`, `src/orchestrator/machine.ts`, `src/demo/fallback.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3), `SseHub` (Task 5), graph `ingestEmail`/`getGraph`/`assembleBriefing` (Tasks 7–8), `assembleCard` (Task 9), `MOCK_INBOX` (Task 10), `detectCompanyIntent`/`decideIvrAction` (Task 11), `getIvrContext` (Task 12), `extractEmailEntities` (Task 13).
- Produces: `IVR_SCRIPT: { prompt: string; atMs: number }[]`, `DEMO_STEP_MS`; `runSession(deps, sessionId): Promise<void>` where `deps = { db, hub }`. Emits SSE events per §5 taxonomy and advances `sessions.status`.
- Produces: `FALLBACK_GRAPH: GraphData`, `FALLBACK_CARD: BriefingCard` in `src/demo/fallback.ts`.

- [ ] **Step 1: Implement `src/orchestrator/timeline.ts`**

```ts
export const DEMO_STEP_MS = 700;         // delay between graph drips
export const IVR_SCRIPT: { prompt: string; atMs: number }[] = [
  { prompt: 'Thank you for calling United. For reservations, press 1.', atMs: 1000 },
  { prompt: 'For an existing reservation, press 2.', atMs: 3000 },
  { prompt: 'To speak with an agent, press 0.', atMs: 5000 },
  { prompt: 'How can I help you today? (say your request)', atMs: 7000 },
];
export const HOLD_MS = 4000;
export const HANDOFF_LINE = 'Thanks for calling United, this is Sarah, how can I help you?';
```

- [ ] **Step 2: Implement `src/demo/fallback.ts`**

```ts
import type { GraphData, BriefingCard } from '../types.js';

export const FALLBACK_CARD: BriefingCard = {
  company: 'United Airlines', user_intent: 'Rebook canceled flight',
  identity: { name: 'Jamie Chen', loyalty_program: 'MileagePlus', loyalty_number: '1234567' },
  booking: { pnr: 'ABC123', flight_number: 'UA1234', route: 'SFO → ORD', date: '2026-07-07', status: 'canceled' },
  payment: { brand: 'Chase Sapphire Preferred', last4: '4242' },
  context: { user_location: 'SFO airport', urgency: 'same-day rebooking needed' },
  suggested_opening:
    "Hi, I'm on booking ABC123, flight UA1234 from SFO to ORD today. It was canceled — I need to rebook. " +
    'My MileagePlus number is 1234567 and I paid with the Chase Sapphire Preferred ending 4242.',
};

export const FALLBACK_GRAPH: GraphData = {
  nodes: [
    { id: 'Person:jamie-chen', type: 'Person', label: 'Jamie Chen', props: {} },
    { id: 'Booking:ABC123', type: 'Booking', label: 'ABC123', props: {} },
    { id: 'Flight:UA1234', type: 'Flight', label: 'UA1234', props: { status: 'canceled' } },
    { id: 'LoyaltyAccount:1234567', type: 'LoyaltyAccount', label: 'MileagePlus', props: {} },
    { id: 'PaymentMethod:chase-4242', type: 'PaymentMethod', label: 'Chase ••4242', props: {} },
  ],
  edges: [
    { id: 'e1', from: 'Person:jamie-chen', to: 'Booking:ABC123', type: 'HAS_BOOKING' },
    { id: 'e2', from: 'Booking:ABC123', to: 'Flight:UA1234', type: 'INCLUDES' },
    { id: 'e3', from: 'Person:jamie-chen', to: 'LoyaltyAccount:1234567', type: 'HAS_LOYALTY' },
    { id: 'e4', from: 'Booking:ABC123', to: 'PaymentMethod:chase-4242', type: 'PAID_WITH' },
  ],
};
```

- [ ] **Step 3: Write the failing test `tests/orchestrator.test.ts`**

This test injects fakes for every dependency so it runs with **no** external services, and asserts the emitted SSE event sequence and status progression.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub, type SseEvent } from '../src/sse/hub.js';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'United Airlines', intent: 'rebook_flight' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'press 1', reasoning: 'reservations' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'press 1 -> 2 -> 0 -> agent') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'ABC123' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({
  DEMO_USER_ID: 'jamie-chen',
  ingestEmail: vi.fn(async () => ({ nodes: [{ id: 'Booking:ABC123', type: 'Booking', label: 'ABC123', props: {} }], edges: [] })),
}));
vi.mock('../src/graph/query.js', () => ({
  getGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  assembleBriefing: vi.fn(async () => ({ pnr: 'ABC123', flight_number: 'UA1234', route: 'SFO → ORD', status: 'canceled', loyalty_program: 'MileagePlus', loyalty_number: '1234567', payment_brand: 'Chase', payment_last4: '4242' })),
}));
vi.mock('../src/demo/inbox.js', () => ({ MOCK_INBOX: [
  { id: 'em1', from: 'united', to: 'j', subject: 'conf ABC123', date: '2026-07-01', body: 'UA1234' },
], EXPECTED_DOSSIER: {} }));

import { runSession } from '../src/orchestrator/machine.js';

describe('runSession', () => {
  let db: ReturnType<typeof createMemoryDb>;
  let hub: ReturnType<typeof createSseHub>;
  let events: SseEvent[];

  beforeEach(async () => {
    db = createMemoryDb(); hub = createSseHub(); events = [];
  });

  it('drives the full status sequence and emits handoff + briefing', async () => {
    const s = await db.createSession({ user_input: 'my United flight got canceled' });
    hub.subscribe(s.id, (e) => events.push(e));
    await runSession({ db, hub, stepMs: 0, holdMs: 0 }, s.id);

    const statuses = events.filter((e) => e.event === 'status').map((e) => (e.data as { status: string }).status);
    expect(statuses).toEqual(['dialing', 'navigating', 'on_hold', 'handoff', 'done']);
    expect(events.some((e) => e.event === 'graph.node')).toBe(true);
    expect(events.some((e) => e.event === 'ivr.decision')).toBe(true);
    expect(events.some((e) => e.event === 'briefing.field')).toBe(true);
    expect(events.some((e) => e.event === 'handoff')).toBe(true);

    expect((await db.getSession(s.id))?.status).toBe('done');
    expect(await db.getBriefingCard(s.id)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — cannot find `../src/orchestrator/machine.js`.

- [ ] **Step 5: Implement `src/orchestrator/machine.ts`**

```ts
import type { Db } from '../db/interface.js';
import type { SseHub } from '../sse/hub.js';
import type { BriefingCard } from '../types.js';
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
import { IVR_SCRIPT, HANDOFF_LINE } from './timeline.js';
import { FALLBACK_CARD } from '../demo/fallback.js';

export interface RunDeps { db: Db; hub: SseHub; stepMs?: number; holdMs?: number; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSession(deps: RunDeps, sessionId: string): Promise<void> {
  const { db, hub } = deps;
  const stepMs = deps.stepMs ?? 700;
  const holdMs = deps.holdMs ?? 4000;

  const session = await db.getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const reason = async (phase: string, message: string) => {
    await db.addReasoning({ session_id: sessionId, phase, message });
    hub.publish(sessionId, 'reasoning', { phase, message, ts: Date.now() });
  };
  const setStatus = async (status: string) => {
    await db.updateSession(sessionId, { status: status as never });
    hub.publish(sessionId, 'status', { status });
  };

  try {
    // 1. intent
    let company = 'United Airlines', intent = 'rebook_flight';
    try { const r = await detectCompanyIntent(session.user_input); company = r.company; intent = r.intent; }
    catch (e) { logger.warn('intent detection failed, using defaults', { error: String(e) }); }
    await db.updateSession(sessionId, { detected_company: company, detected_intent: intent });
    await reason('extracting', `Target: ${company} — intent ${intent}`);

    // 2. extraction → graph (drip)
    for (const email of MOCK_INBOX) {
      let created;
      try {
        const entities = await extractEmailEntities(email);
        created = await ingestEmail(DEMO_USER_ID, email, entities);
      } catch (e) { logger.warn('extract/ingest failed for email', { id: email.id, error: String(e) }); continue; }
      for (const n of created.nodes) hub.publish(sessionId, 'graph.node', n);
      for (const ed of created.edges) hub.publish(sessionId, 'graph.edge', ed);
      if (created.nodes.length) await reason('extracting', `Parsed ${email.subject}`);
      await sleep(stepMs);
    }

    // 3. dial + navigate
    await setStatus('dialing');
    await sleep(stepMs);
    await setStatus('navigating');
    const ragContext = await getIvrContext('How do I reach a human agent at United to rebook a canceled flight?');
    for (const beat of IVR_SCRIPT) {
      let decision = 'press 0', reasoning = 'reach an agent';
      try { const d = await decideIvrAction(beat.prompt, ragContext); decision = d.decision; reasoning = d.reasoning; }
      catch (e) { logger.warn('ivr decision failed, using default', { error: String(e) }); }
      await db.addIvrDecision({ session_id: sessionId, prompt_text: beat.prompt, decision, reasoning });
      hub.publish(sessionId, 'ivr.decision', { prompt_text: beat.prompt, decision, reasoning, ts: Date.now() });
      hub.publish(sessionId, 'audio.cue', { cue: 'ivr', at_ms: beat.atMs });
      await sleep(stepMs);
    }

    // 4. hold + briefing assembly
    await setStatus('on_hold');
    hub.publish(sessionId, 'audio.cue', { cue: 'hold', at_ms: 0 });
    let card: BriefingCard;
    try {
      const dossier = neo4jConfigured() ? await assembleBriefing(DEMO_USER_ID) : null;
      card = assembleCard(dossier, { company, intent: 'Rebook canceled flight', location: 'SFO airport', urgency: 'same-day rebooking needed' });
      if (!card.booking.pnr) card = FALLBACK_CARD; // demo safety
    } catch (e) {
      logger.warn('briefing assembly failed, using fallback card', { error: String(e) });
      card = FALLBACK_CARD;
    }
    // progressive field emission
    const fields: [string, unknown][] = [
      ['identity.name', card.identity.name], ['booking.pnr', card.booking.pnr],
      ['booking.flight_number', card.booking.flight_number], ['booking.route', card.booking.route],
      ['booking.status', card.booking.status], ['identity.loyalty_number', card.identity.loyalty_number],
      ['payment.last4', card.payment.last4],
    ];
    for (const [path, value] of fields) {
      hub.publish(sessionId, 'briefing.field', { path, value });
      await sleep(Math.min(stepMs, 300));
    }
    await db.saveBriefingCard(sessionId, card, card.suggested_opening);
    await sleep(holdMs);

    // 5. handoff
    await setStatus('handoff');
    await reason('handoff', HANDOFF_LINE);
    hub.publish(sessionId, 'handoff', { suggested_opening: card.suggested_opening });
    await setStatus('done');
    hub.publish(sessionId, 'done', {});
  } catch (e) {
    logger.error('runSession fatal', { sessionId, error: String(e) });
    await setStatus('done');
    hub.publish(sessionId, 'done', { error: String(e) });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/ src/demo/fallback.ts tests/orchestrator.test.ts
git commit -m "feat: orchestrator state machine + demo timeline + fallback"
```

---

### Task 15: Routes + server wiring

**Files:**
- Create: `src/routes/sessions.ts`, `src/server.ts`
- Test: `tests/routes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildServer(deps): FastifyInstance` with all §5 endpoints; `src/server.ts` boots it (initSchema if Neo4j configured, start RocketRide pipeline if configured, listen on `config.port`).

- [ ] **Step 1: Write the failing test `tests/routes.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/orchestrator/machine.js', () => ({
  runSession: vi.fn(async (deps: { hub: { publish: (s: string, e: string, d: unknown) => void } }, id: string) => {
    deps.hub.publish(id, 'status', { status: 'done' });
  }),
}));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn() }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('routes', () => {
  it('POST /sessions creates a session and returns detected fields', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'united canceled' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session_id).toBeTruthy();
    expect(body.status).toBe('extracting');
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

  app.post<{ Body: { user_input: string } }>('/sessions', async (req, reply) => {
    const { user_input } = req.body ?? {};
    if (!user_input) return reply.code(400).send({ error: 'user_input required' });
    const s = await db.createSession({ user_input });
    // fire-and-forget orchestration
    void runSession({ db, hub }, s.id);
    return reply.code(201).send({
      session_id: s.id, detected_company: s.detected_company, detected_intent: s.detected_intent, status: s.status,
    });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = await db.getSession(req.params.id);
    return s ? reply.send(s) : reply.code(404).send({ error: 'not found' });
  });

  app.get('/sessions/:id/graph', async (_req, reply) => {
    try { return reply.send(neo4jConfigured() ? await getGraph() : FALLBACK_GRAPH); }
    catch { return reply.send(FALLBACK_GRAPH); }
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/ivr-log', async (req, reply) => {
    return reply.send(await db.listIvrDecisions(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/reasoning', async (req, reply) => {
    return reply.send(await db.listReasoning(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/briefing', async (req, reply) => {
    const card = await db.getBriefingCard(req.params.id);
    return card ? reply.send({ card_json: card.card_json, suggested_opening: card.suggested_opening })
                : reply.code(404).send({ error: 'not ready' });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/audio', async (_req, reply) => {
    // Presigned URL wiring is optional for the demo; return the object id/path for the frontend.
    return reply.send({ url: config.recordedAudioObjectId || '/demo/united-recorded-call.mp3' });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/events', (req, reply) => {
    const id = req.params.id;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': config.corsOrigin,
    });
    const write = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of hub.replayBuffer(id)) write(e.event, e.data);      // catch up
    const off = hub.subscribe(id, (e) => write(e.event, e.data));       // live
    req.raw.on('close', () => off());
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
import { rocketrideConfigured } from './extraction/rocketride.js';
import { startExtractionPipeline } from './extraction/rocketride.js';

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
git commit -m "feat: REST + SSE routes and server wiring"
```

---

### Task 16: End-to-end smoke + README

**Files:**
- Create: `tests/e2e.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildServer`, memory db, sse hub, real `runSession` (with mocked externals so it runs offline).

- [ ] **Step 1: Write `tests/e2e.test.ts`** (runs fully offline via mocks; proves complaint → SSE handoff → briefing endpoint)

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ai/intent.js', () => ({ detectCompanyIntent: vi.fn(async () => ({ company: 'United Airlines', intent: 'rebook_flight' })) }));
vi.mock('../src/ai/ivr.js', () => ({ decideIvrAction: vi.fn(async () => ({ decision: 'press 1', reasoning: 'r' })) }));
vi.mock('../src/rag/query.js', () => ({ getIvrContext: vi.fn(async () => 'ctx') }));
vi.mock('../src/extraction/index.js', () => ({ extractEmailEntities: vi.fn(async () => ({ booking: { pnr: 'ABC123' } })) }));
vi.mock('../src/graph/neo4j.js', () => ({ neo4jConfigured: () => false, initSchema: vi.fn(), closeDriver: vi.fn() }));
vi.mock('../src/graph/ingest.js', () => ({ DEMO_USER_ID: 'jamie-chen', ingestEmail: vi.fn(async () => ({ nodes: [{ id: 'Booking:ABC123', type: 'Booking', label: 'ABC123', props: {} }], edges: [] })) }));
vi.mock('../src/graph/query.js', () => ({ getGraph: vi.fn(async () => ({ nodes: [], edges: [] })), assembleBriefing: vi.fn(async () => null) }));
vi.mock('../src/demo/inbox.js', () => ({ MOCK_INBOX: [{ id: 'em1', from: 'u', to: 'j', subject: 'ABC123', date: '2026-07-01', body: 'UA1234' }], EXPECTED_DOSSIER: {} }));

import { buildServer } from '../src/routes/sessions.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createSseHub } from '../src/sse/hub.js';

describe('e2e (offline)', () => {
  it('complaint → orchestration → briefing available', async () => {
    const app = buildServer({ db: createMemoryDb(), hub: createSseHub() });
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { user_input: 'United canceled, rebook' } });
    const { session_id } = res.json();

    // poll the briefing endpoint until the fire-and-forget orchestration finishes
    let card = null;
    for (let i = 0; i < 50 && !card; i++) {
      const b = await app.inject({ method: 'GET', url: `/sessions/${session_id}/briefing` });
      if (b.statusCode === 200) card = b.json();
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(card).toBeTruthy();
    expect(card.suggested_opening).toContain('ABC123');
    await app.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all unit tests PASS; integration tests PASS or SKIP depending on which creds are present. No failures.

- [ ] **Step 4: Create `README.md`**

```markdown
# BlackBox Backend

AI-concierge backend: complaint → Neo4j identity graph → briefing card, streamed live over SSE.
See `docs/superpowers/specs/2026-07-07-blackbox-backend-design.md`.

## Run
1. `npm install`
2. Fill `.env` (copy from `.env.example`). Neo4j password + Butterbase key required for the full path; the service still boots without them (in-memory + fallbacks).
3. `npm run seed:rag` (once, populates the RAG corpus)
4. `npm start` → http://localhost:4000

## Endpoints (for the frontend)
- `POST /sessions` `{user_input}` → `{session_id, detected_company, detected_intent, status}`
- `GET /sessions/:id` · `/graph` · `/ivr-log` · `/reasoning` · `/briefing` · `/audio`
- `GET /sessions/:id/events` — SSE: `status, graph.node, graph.edge, ivr.decision, audio.cue, briefing.field, reasoning, handoff, done`

## Test
`npm test` — unit tests always run; integration tests self-skip when their creds are absent.
```

- [ ] **Step 5: Manual smoke (optional, needs `.env`)**

Run: `npm start` in one shell, then in another:
`curl -s -X POST localhost:4000/sessions -H 'Content-Type: application/json' -d '{"user_input":"My United flight to Chicago was canceled, rebook"}'`
Then: `curl -N localhost:4000/sessions/<id>/events` and watch the event stream through to `handoff`/`done`.
Expected: status progression and a populated briefing at `GET /sessions/<id>/briefing`.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e.test.ts README.md
git commit -m "test: offline e2e + README"
```

---

## Self-Review

**Spec coverage** (spec §5 API, §4 flow, §6 data model, §8 safety, §9 testing):
- POST/GET session, graph, ivr-log, briefing, reasoning, audio, SSE events → Task 15. ✅
- Complaint→intent → Task 11; extraction→graph → Tasks 7/13; briefing query → Task 8; card → Task 9; RAG/IVR → Tasks 11/12; orchestration/timeline → Task 14. ✅
- Butterbase tables via adapter → Tasks 3/4 (schema already provisioned in the spec). ✅
- Neo4j schema + one-query dossier → Tasks 6/8. ✅
- Demo safety (in-memory fallback, partial dossier via OPTIONAL MATCH, seeded fallback graph/card) → Tasks 4/8/14. ✅
- Tests: unit + integration + smoke → every task + Task 16. ✅
- Three sponsors load-bearing: RocketRide extraction (13), Butterbase db/AI/RAG/storage-audio (4/11/12/15), Neo4j graph (6–8). ✅

**Placeholder scan:** `extraction.pipe` `project_id` is the one intentional fill-in (`uuidgen`, flagged in Task 13 Step 2). RAG REST path flagged to confirm against docs (Task 12). No other TBDs.

**Type consistency:** `Db`, `SseHub`/`SseEvent`, `GraphNode/GraphEdge/GraphData`, `BriefingDossier/BriefingCard`, `ExtractedEntities`, `runSession(deps, id)`, `extractEmailEntities`, `assembleBriefing(userId)`, `assembleCard(dossier, ctx)` are used identically across tasks.

## Notes for the implementer
- **Order matters:** Tasks 1→16 are dependency-ordered. Integration tests (Neo4j, Butterbase, RocketRide, RAG) self-skip when creds are absent, so the plan is fully executable offline; wire real creds to flip them from SKIP to PASS.
- **Two external blockers** (from the spec, tracked separately): correct `NEO4J_PASSWORD`, and RocketRide API key + `ROCKETRIDE_OPENAI_KEY`. Neither blocks any task — they flip skipped integration tests to green.
- **Read before writing the `.pipe`:** `.rocketride/docs/ROCKETRIDE_PIPELINE_RULES.md` + `ROCKETRIDE_COMPONENT_REFERENCE.md` (Task 13) for exact `llm_openai` config.
