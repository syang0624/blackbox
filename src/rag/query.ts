import { config } from '../config.js';
import { logger } from '../logger.js';

export async function getIvrContext(query: string): Promise<string> {
  try {
    const url = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/rag/${config.butterbase.ragCollection}/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: 3, synthesize: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn('rag query failed', { status: res.status });
      return '';
    }
    const data = (await res.json()) as { answer?: string; chunks?: { text: string }[] };
    return data.answer ?? (data.chunks ?? []).map((c) => c.text).join('\n');
  } catch (e) {
    logger.warn('rag query error', { error: String(e) });
    return '';
  }
}
