import { RocketRideClient, Question } from 'rocketride';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

let client: RocketRideClient | null = null;
let token: string | null = null;

const PIPE = new URL('./extraction.pipe', import.meta.url).pathname;

export function rocketrideConfigured(): boolean {
  return config.rocketride.configured;
}

export async function startExtractionPipeline(): Promise<void> {
  process.env.ROCKETRIDE_BUTTERBASE_API_KEY = config.butterbase.apiKey;
  process.env.ROCKETRIDE_BUTTERBASE_BASE_URL = config.butterbase.llmBaseUrl;
  process.env.ROCKETRIDE_BUTTERBASE_MODEL = config.butterbase.model;
  client = new RocketRideClient();
  await client.connect();
  const res = await client.use({ filepath: PIPE, useExisting: true });
  token = res.token;
  logger.info('rocketride: extraction pipeline ready', { token });
}

export async function stopExtractionPipeline(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
    token = null;
  }
}

export async function extractWithRocketRide(email: MockEmail): Promise<ExtractedEntities> {
  if (!client || !token) throw new Error('rocketride pipeline not started');
  const q = new Question({ expectJson: true });
  q.addInstruction(
    'Task',
    'Extract structured travel entities from the email. Omit unknown fields. Only last4 for payment. Include baggage {tag,damage} if present.',
  );
  q.addExample('Asiana confirmation email', {
    person: { name: 'Steven Yang' },
    booking: { pnr: 'XKRF2M', airline: 'Asiana Airlines' },
    flight: { number: 'OZ212', date: '2026-07-03', route: 'ICN -> SFO', from: 'ICN', to: 'SFO', status: 'completed' },
  });
  q.addContext(`From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`);
  q.addQuestion('Return the entities as JSON.');
  const resp = await client.chat({ token, question: q });
  const first = resp.answers?.[0];
  if (first === undefined || first === null) throw new Error('rocketride: empty answer');
  return (typeof first === 'string' ? JSON.parse(first) : first) as ExtractedEntities;
}
