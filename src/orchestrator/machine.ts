import { randomUUID } from 'node:crypto';
import type { Db } from '../db/interface.js';
import type { SseHub } from '../sse/hub.js';
import type { BriefingCard, GraphData, IvrDecision, ReasoningEntry, SessionStatus } from '../types.js';
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

export interface RunDeps {
  db: Db;
  hub: SseHub;
  stepMs?: number;
  holdMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAsianaDemoInput(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes('asiana') && lower.includes('suitcase');
}

function genericGraph(company: string, intent: string, userInput: string): GraphData {
  return {
    nodes: [
      { id: 'Person:customer', type: 'Person', label: 'Customer' },
      { id: 'Email:complaint', type: 'Email', label: userInput.slice(0, 48) || 'Support request' },
      { id: 'Airline:company', type: 'Airline', label: company },
      { id: 'Attachment:intent', type: 'Attachment', label: intent.replace(/_/g, ' ') },
    ],
    edges: [
      { id: 'g1', source: 'Person:customer', target: 'Email:complaint', type: 'SENT_BY' },
      { id: 'g2', source: 'Email:complaint', target: 'Airline:company', type: 'MENTIONS' },
      { id: 'g3', source: 'Email:complaint', target: 'Attachment:intent', type: 'MENTIONS' },
    ],
  };
}

function genericCard(company: string, intent: string, userInput: string): BriefingCard {
  const readableIntent = intent.replace(/_/g, ' ');
  return {
    company,
    user_intent: readableIntent,
    identity: { name: 'Customer', loyalty_program: '', loyalty_number: '' },
    booking: { pnr: '', flight_number: '', route: '', date: '', status: '' },
    payment: { brand: '', last4: '' },
    context: {
      user_location: '',
      urgency: userInput,
    },
    suggested_opening: `Hi, I am calling about ${readableIntent} with ${company}. ${userInput}`,
  };
}

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
  const setStatus = async (status: SessionStatus) => {
    await db.updateSession(sessionId, { status });
    hub.publish(sessionId, 'status', { status });
  };
  const emitGraph = async () => {
    let g: GraphData;
    try {
      g = neo4jConfigured() ? await getGraph() : FALLBACK_GRAPH;
    } catch {
      g = FALLBACK_GRAPH;
    }
    hub.publish(sessionId, 'graph', g);
  };

  try {
    let company = 'Asiana Airlines';
    let intent = 'baggage_damage_claim';
    try {
      const r = await detectCompanyIntent(session.user_input);
      company = r.company;
      intent = r.intent;
    } catch (e) {
      logger.warn('intent detection failed, using defaults', { error: String(e) });
    }
    await db.updateSession(sessionId, { detected_company: company, detected_intent: intent });
    await reason('info', `Identified company: ${company}. Intent: ${intent.replace(/_/g, ' ')}.`);

    if (!isAsianaDemoInput(session.user_input)) {
      const g = genericGraph(company, intent, session.user_input);
      hub.publish(sessionId, 'graph', g);
      await reason('extraction', 'Created a support graph from the customer request.');
      await sleep(stepMs);

      await setStatus('dialing');
      await reason('info', `Preparing to contact ${company} support.`);
      await sleep(stepMs);

      await setStatus('navigating');
      const prompt = `Route this customer to the best support queue for: ${session.user_input}`;
      let decision = 'Ask for a human agent';
      let reasoning = 'The request is specific enough that a human support representative should handle it.';
      try {
        const d = await decideIvrAction(prompt, `Company: ${company}\nIntent: ${intent}`);
        decision = d.decision;
        reasoning = d.reasoning;
      } catch (e) {
        logger.warn('generic ivr decision failed, using default', { error: String(e) });
      }
      const row = await db.addIvrDecision({ session_id: sessionId, prompt_text: prompt, decision, reasoning });
      const ivr: IvrDecision = { id: row.id, prompt_text: prompt, decision, reasoning, timestamp: row.created_at };
      hub.publish(sessionId, 'ivr', ivr);
      await reason('decision', `Support routing: ${decision} - ${reasoning}`);
      await sleep(stepMs);

      await setStatus('on_hold');
      const card = genericCard(company, intent, session.user_input);
      await db.saveBriefingCard(sessionId, card, card.suggested_opening);
      hub.publish(sessionId, 'briefing', card);
      await reason('info', 'Generated a generic support briefing from the request.');
      await sleep(holdMs);
      return;
    }

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
      } catch (e) {
        logger.warn('extract/ingest failed for email', { id: email.id, error: String(e) });
      }
      await sleep(stepMs);
    }
    await emitGraph();

    await setStatus('dialing');
    await reason('info', `Dialing ${company} customer service.`);
    await sleep(stepMs);
    await setStatus('navigating');
    const ragContext = await getIvrContext('How do I reach an Asiana agent to file a baggage damage claim?');
    for (const beat of ASIANA_IVR_SCRIPT) {
      let decision = 'Press 5';
      let reasoning = 'Reach a human agent';
      try {
        const d = await decideIvrAction(beat.prompt, ragContext);
        decision = d.decision;
        reasoning = d.reasoning;
      } catch (e) {
        logger.warn('ivr decision failed, using default', { error: String(e) });
      }
      const row = await db.addIvrDecision({ session_id: sessionId, prompt_text: beat.prompt, decision, reasoning });
      const ivr: IvrDecision = { id: row.id, prompt_text: beat.prompt, decision, reasoning, timestamp: row.created_at };
      hub.publish(sessionId, 'ivr', ivr);
      await reason('decision', `IVR: ${decision} - ${reasoning}`);
      await sleep(stepMs);
    }

    await setStatus('on_hold');
    await reason('info', 'On hold. Assembling briefing card from graph...');
    let card: BriefingCard;
    try {
      const dossier = neo4jConfigured() ? await assembleBriefing(DEMO_USER_ID) : null;
      card = assembleCard(dossier, {
        company,
        intent: 'File baggage damage claim',
        location: 'San Francisco',
        urgency: 'Suitcase broken on arrival - need damage claim filed within 7 days',
      });
      if (!card.booking.pnr) card = FALLBACK_CARD;
    } catch (e) {
      logger.warn('briefing assembly failed, using fallback card', { error: String(e) });
      card = FALLBACK_CARD;
    }
    await db.saveBriefingCard(sessionId, card, card.suggested_opening);
    hub.publish(sessionId, 'briefing', card);
    await sleep(holdMs);
  } catch (e) {
    logger.error('runSession fatal', { sessionId, error: String(e) });
    const entry: ReasoningEntry = {
      id: randomUUID(),
      message: `Error: ${String(e)}`,
      timestamp: new Date().toISOString(),
      type: 'error',
    };
    hub.publish(sessionId, 'reasoning', entry);
  }
}
