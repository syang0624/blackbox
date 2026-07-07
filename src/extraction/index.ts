import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';
import { extractWithButterbase } from '../ai/extract.js';
import { extractWithRocketRide, rocketrideConfigured } from './rocketride.js';

function extractWithFixtureFallback(email: MockEmail): ExtractedEntities {
  const text = `${email.subject}\n${email.body}`;
  const out: ExtractedEntities = {};

  if (/steven yang/i.test(text)) out.person = { id: 'steven-yang', name: 'Steven Yang', email: email.to };
  if (/XKRF2M/i.test(text)) out.booking = { pnr: 'XKRF2M', airline: 'Asiana Airlines' };
  if (/OZ212|ICN|SFO|Incheon|San Francisco/i.test(text)) {
    out.flight = {
      number: 'OZ212',
      date: '2026-07-03',
      route: 'ICN -> SFO',
      from: 'ICN',
      to: 'SFO',
      status: /arrived|thanks for flying/i.test(text) ? 'completed' : 'confirmed',
      airline: 'Asiana Airlines',
    };
    out.airports = ['ICN', 'SFO'];
  }
  if (/920384712|Asiana Club/i.test(text)) {
    out.loyalty = { program: 'Asiana Club', number: '920384712', airline: 'Asiana Airlines' };
  }
  if (/1087|American Express|Amex/i.test(text)) out.payment = { brand: 'American Express', last4: '1087' };
  if (/0988-7234|baggage tag/i.test(text)) out.baggage = { tag: '0988-7234', damage: 'broken suitcase' };

  return out;
}

export async function extractEmailEntities(email: MockEmail): Promise<ExtractedEntities> {
  if (rocketrideConfigured()) {
    try {
      return await extractWithRocketRide(email);
    } catch (e) {
      logger.warn('rocketride extract failed, falling back to butterbase', { id: email.id, error: String(e) });
    }
  }
  try {
    return await extractWithButterbase(email);
  } catch (e) {
    logger.warn('butterbase extract failed, using fixture fallback', { id: email.id, error: String(e) });
    return extractWithFixtureFallback(email);
  }
}
