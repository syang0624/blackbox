import { config } from './config.js';
import { logger } from './logger.js';
import { createDb } from './db/index.js';
import { createSseHub } from './sse/hub.js';
import { buildServer } from './routes/sessions.js';
import { neo4jConfigured, initSchema, disableNeo4j } from './graph/neo4j.js';
import { rocketrideConfigured, startExtractionPipeline } from './extraction/rocketride.js';

async function main() {
  if (neo4jConfigured()) {
    try {
      await initSchema();
      logger.info('neo4j schema ready');
    } catch (e) {
      logger.error('neo4j schema init failed', { error: String(e) });
      disableNeo4j();
    }
  }
  if (rocketrideConfigured()) {
    try {
      await startExtractionPipeline();
    } catch (e) {
      logger.error('rocketride pipeline start failed (will fall back to Butterbase)', { error: String(e) });
    }
  }
  const app = buildServer({ db: createDb(), hub: createSseHub() });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('BlackBox backend listening', { port: config.port });
}

main().catch((e) => {
  logger.error('startup failed', { error: String(e) });
  process.exit(1);
});
