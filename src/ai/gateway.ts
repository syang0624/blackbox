import { config } from '../config.js';

export function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

export async function chatJson<T>(system: string, user: string): Promise<T> {
  const url = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.butterbase.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(extractJsonBlock(data.choices[0].message.content)) as T;
}
