import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

const base = {
  PORT: '8000', CORS_ORIGIN: 'http://localhost:3000',
  BUTTERBASE_API_URL: 'https://api.butterbase.ai', BUTTERBASE_APP_ID: 'app_x',
  BUTTERBASE_API_KEY: 'bb_sk_x', BUTTERBASE_BASE_URL: 'https://api.butterbase.ai/v1',
  BUTTERBASE_MODEL: 'anthropic/claude-sonnet-4.5',
  BUTTERBASE_RAG_COLLECTION: 'support-knowledge',
  NEO4J_URI: 'neo4j+s://x', NEO4J_USERNAME: 'neo4j', NEO4J_PASSWORD: 'p', NEO4J_DATABASE: 'neo4j',
};

describe('parseConfig', () => {
  it('parses a full env into typed config', () => {
    const c = parseConfig(base);
    expect(c.port).toBe(8000);
    expect(c.butterbase.appId).toBe('app_x');
    expect(c.butterbase.model).toBe('anthropic/claude-sonnet-4.5');
    expect(c.neo4j.database).toBe('neo4j');
  });

  it('defaults the port to 8000 to match the frontend', () => {
    const { PORT, ...noPort } = base;
    expect(parseConfig(noPort).port).toBe(8000);
  });

  it('detects placeholder Butterbase creds as not-configured', () => {
    expect(parseConfig({ ...base, BUTTERBASE_API_KEY: 'your_butterbase_server_api_key' }).butterbase.configured).toBe(false);
  });

  it('treats a real bb_sk_ key as configured', () => {
    expect(parseConfig(base).butterbase.configured).toBe(true);
  });
});
