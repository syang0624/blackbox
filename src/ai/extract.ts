import { chatJson } from './gateway.js';
import type { MockEmail, ExtractedEntities } from '../types.js';

const SYSTEM =
  'Extract structured travel entities from a single email. Respond ONLY with JSON matching: ' +
  '{"person":{"name","email"},"booking":{"pnr","airline"},' +
  '"flight":{"number","date","route","from","to","status","airline"},' +
  '"loyalty":{"program","number","airline"},"payment":{"brand","last4"},' +
  '"baggage":{"tag","damage"},"airports":[string]}. ' +
  'Omit fields you cannot find. NEVER include a full card number - only last4. ' +
  'date is ISO yyyy-mm-dd. status is one of confirmed|completed|canceled|unknown. ' +
  'from/to and airports use IATA codes (e.g. ICN, SFO). ' +
  'If the email is unrelated to air travel, return {}.';

export async function extractWithButterbase(email: MockEmail): Promise<ExtractedEntities> {
  return chatJson<ExtractedEntities>(
    SYSTEM,
    `From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`,
  );
}
