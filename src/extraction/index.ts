import { logger } from '../logger.js';
import type { MockEmail, ExtractedEntities } from '../types.js';
import { extractWithButterbase } from '../ai/extract.js';
import { extractWithRocketRide, rocketrideConfigured } from './rocketride.js';

export async function extractEmailEntities(email: MockEmail): Promise<ExtractedEntities> {
  if (rocketrideConfigured()) {
    try {
      return await extractWithRocketRide(email);
    } catch (e) {
      logger.warn('rocketride extract failed, falling back to butterbase', { id: email.id, error: String(e) });
    }
  }
  return extractWithButterbase(email);
}
