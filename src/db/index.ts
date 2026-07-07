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
  logger.warn('db: Butterbase not configured - using in-memory adapter');
  return createMemoryDb();
}
