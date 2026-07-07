import { chatJson } from './gateway.js';

export async function decideIvrAction(promptText: string, ragContext: string): Promise<{ decision: string; reasoning: string }> {
  return chatJson(
    'You are navigating a phone IVR to reach a human agent for a baggage damage claim with Asiana Airlines. ' +
      'Given the IVR prompt and reference context, decide the single next action. ' +
      'Respond ONLY with JSON: {"decision": string, "reasoning": string}. ' +
      'decision is like "Press 2", "Press 5", or "Entered 920384712*".',
    `IVR prompt: ${promptText}\n\nReference context:\n${ragContext}`,
  );
}
