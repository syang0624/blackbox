import { chatJson } from './gateway.js';

export async function detectCompanyIntent(userInput: string): Promise<{ company: string; intent: string }> {
  return chatJson(
    'You identify the target company and the support intent from a customer complaint. ' +
      'Respond ONLY with JSON: {"company": string, "intent": string}. ' +
      'intent is a short snake_case slug like baggage_damage_claim or refund_request.',
    userInput,
  );
}
