import { readFileSync } from 'node:fs';
import { Answer, RocketRideClient, Question } from 'rocketride';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

let client: RocketRideClient | null = null;
let token: string | null = null;

const PIPE = new URL('./extraction.pipe', import.meta.url).pathname;

const ROCKETRIDE_ENV_PATTERN = /\$\{ROCKETRIDE_([A-Z0-9_]+)\}/g;

function rocketrideEnv(): Record<string, string> {
  return {
    ...process.env,
    ROCKETRIDE_URI: config.rocketride.uri,
    ROCKETRIDE_APIKEY: config.rocketride.apikey,
    ROCKETRIDE_BUTTERBASE_API_KEY: config.butterbase.apiKey,
    ROCKETRIDE_BUTTERBASE_BASE_URL: config.butterbase.llmBaseUrl,
    ROCKETRIDE_BUTTERBASE_MODEL: config.butterbase.model,
    ROCKETRIDE_NEO4J_URI: config.neo4j.uri,
    ROCKETRIDE_NEO4J_USER: config.neo4j.username,
    ROCKETRIDE_NEO4J_PASSWORD: config.neo4j.password,
    ROCKETRIDE_NEO4J_DATABASE: config.neo4j.database,
  } as Record<string, string>;
}

function rocketEnvFrom(env: Record<string, string>): Record<string, string> {
  const rocketEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('ROCKETRIDE_') && value) rocketEnv[key] = value;
  }
  return rocketEnv;
}

function substitutePipelineEnv<T>(pipeline: T, env: Record<string, string>): T {
  const json = JSON.stringify(pipeline).replace(ROCKETRIDE_ENV_PATTERN, (_match, key: string) => {
    const value = env[`ROCKETRIDE_${key}`];
    return value ?? _match;
  });
  return JSON.parse(json) as T;
}

function loadPipeline(env: Record<string, string>): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(PIPE, 'utf8')) as Record<string, unknown>;
  return substitutePipelineEnv(raw, env);
}

function extractAnswerValue(resp: Record<string, unknown>): unknown {
  if (resp.data && typeof resp.data === 'object' && 'answer' in resp.data) {
    return (resp.data as Record<string, unknown>).answer;
  }
  if (Array.isArray(resp.answers)) return resp.answers[0];

  const resultTypes = resp.result_types;
  if (resultTypes && typeof resultTypes === 'object') {
    for (const [field, type] of Object.entries(resultTypes as Record<string, unknown>)) {
      if (type === 'answers') {
        const value = resp[field];
        return Array.isArray(value) ? value[0] : value;
      }
    }
  }

  return undefined;
}

function parseExtractedEntities(value: unknown): ExtractedEntities {
  if (value === undefined || value === null) throw new Error('rocketride: empty answer');
  if (typeof value === 'object') return value as ExtractedEntities;

  const answer = new Answer(true);
  answer.setAnswer(String(value));
  const parsed = answer.isJson() ? answer.getJson() : JSON.parse(answer.getText());
  return parsed as ExtractedEntities;
}

export function rocketrideConfigured(): boolean {
  return config.rocketride.configured;
}

export async function startExtractionPipeline(): Promise<void> {
  const env = rocketrideEnv();
  for (const key of [
    'ROCKETRIDE_BUTTERBASE_API_KEY',
    'ROCKETRIDE_BUTTERBASE_BASE_URL',
    'ROCKETRIDE_BUTTERBASE_MODEL',
    'ROCKETRIDE_NEO4J_URI',
    'ROCKETRIDE_NEO4J_USER',
    'ROCKETRIDE_NEO4J_PASSWORD',
    'ROCKETRIDE_NEO4J_DATABASE',
  ] as const) {
    process.env[key] = env[key];
  }

  client = new RocketRideClient({
    auth: config.rocketride.apikey,
    uri: config.rocketride.uri,
    env,
    requestTimeout: 60_000,
  });
  await client.connect();
  const pipeline = loadPipeline(env);
  await client.validate({ pipeline, source: 'chat_1' });
  const res = await client.use({ pipeline, useExisting: true, env: rocketEnvFrom(env) });
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
  return parseExtractedEntities(extractAnswerValue(resp));
}
