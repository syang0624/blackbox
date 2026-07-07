import 'dotenv/config';

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.startsWith('your_') || v.includes('YOUR_') || v.trim() === '';
}

export interface Config {
  port: number;
  corsOrigin: string;
  butterbase: {
    apiUrl: string; appId: string; apiKey: string; llmBaseUrl: string; model: string;
    ragCollection: string; configured: boolean;
  };
  neo4j: { uri: string; username: string; password: string; database: string; configured: boolean };
  rocketride: { uri: string; apikey: string; configured: boolean };
  recordedAudioObjectId: string;
  flags: { recordedDemo: boolean; realPhone: boolean };
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const bbKey = env.BUTTERBASE_API_KEY ?? '';
  return {
    port: Number(env.PORT ?? 8000),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3000',
    butterbase: {
      apiUrl: env.BUTTERBASE_API_URL ?? 'https://api.butterbase.ai',
      appId: env.BUTTERBASE_APP_ID ?? '',
      apiKey: bbKey,
      llmBaseUrl: env.BUTTERBASE_BASE_URL ?? 'https://api.butterbase.ai/v1',
      model: env.BUTTERBASE_MODEL ?? env.BUTTERBASE_AI_MODEL ?? 'anthropic/claude-sonnet-4.5',
      ragCollection: env.BUTTERBASE_RAG_COLLECTION ?? 'support-knowledge',
      configured: !isPlaceholder(env.BUTTERBASE_APP_ID) && bbKey.startsWith('bb_sk_'),
    },
    neo4j: {
      uri: env.NEO4J_URI ?? '', username: env.NEO4J_USERNAME ?? 'neo4j',
      password: env.NEO4J_PASSWORD ?? '', database: env.NEO4J_DATABASE ?? 'neo4j',
      configured: !isPlaceholder(env.NEO4J_URI) && !isPlaceholder(env.NEO4J_PASSWORD),
    },
    rocketride: {
      uri: env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai',
      apikey: env.ROCKETRIDE_APIKEY ?? '',
      configured: !isPlaceholder(env.ROCKETRIDE_APIKEY),
    },
    recordedAudioObjectId: env.RECORDED_CALL_AUDIO_OBJECT_ID ?? '',
    flags: {
      recordedDemo: (env.ENABLE_RECORDED_CALL_DEMO ?? 'true') === 'true',
      realPhone: (env.ENABLE_REAL_PHONE_CALL ?? 'false') === 'true',
    },
  };
}

export const config = parseConfig(process.env as Record<string, string | undefined>);
