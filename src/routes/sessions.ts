import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/interface.js';
import type { SseHub } from '../sse/hub.js';
import { config } from '../config.js';
import { runSession } from '../orchestrator/machine.js';
import { getGraph } from '../graph/query.js';
import { neo4jConfigured } from '../graph/neo4j.js';
import { FALLBACK_GRAPH } from '../demo/fallback.js';

export interface ServerDeps {
  db: Db;
  hub: SseHub;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, hub } = deps;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return reply.send();
  });

  app.post<{ Body: { user_input: string } }>('/sessions', async (req, reply) => {
    const { user_input } = req.body ?? {};
    if (!user_input) return reply.code(400).send({ error: 'user_input required' });
    const s = await db.createSession({ user_input });
    void runSession({ db, hub }, s.id);
    return reply.code(201).send(s);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = await db.getSession(req.params.id);
    return s ? reply.send(s) : reply.code(404).send({ error: 'not found' });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/stream', (req, reply) => {
    const id = req.params.id;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.corsOrigin,
    });
    const write = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of hub.replayBuffer(id)) write(e.event, e.data);
    const off = hub.subscribe(id, (e) => write(e.event, e.data));
    req.raw.on('close', () => off());
  });

  app.get('/sessions/:id/graph', async (_req, reply) => {
    try {
      return reply.send(neo4jConfigured() ? await getGraph() : FALLBACK_GRAPH);
    } catch {
      return reply.send(FALLBACK_GRAPH);
    }
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/ivr-log', async (req, reply) => {
    const rows = await db.listIvrDecisions(req.params.id);
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        prompt_text: r.prompt_text,
        decision: r.decision,
        reasoning: r.reasoning,
        timestamp: r.created_at,
      })),
    );
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
