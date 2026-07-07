import { describe, it, expect } from 'vitest';
import { assembleCard } from '../src/briefing/assemble.js';

const ctx = {
  company: 'Asiana Airlines',
  intent: 'File baggage damage claim',
  location: 'San Francisco',
  urgency: 'Suitcase broken on arrival - need damage claim filed within 7 days',
};

describe('assembleCard', () => {
  it('maps a full dossier into the frontend card shape with a baggage-claim opening', () => {
    const card = assembleCard(
      {
        pnr: 'XKRF2M',
        flight_number: 'OZ212',
        route: 'ICN -> SFO',
        date: '2026-07-03',
        status: 'completed',
        name: 'Steven Yang',
        loyalty_program: 'Asiana Club',
        loyalty_number: '920384712',
        payment_brand: 'American Express',
        payment_last4: '1087',
        baggage_tag: '0988-7234',
      },
      ctx,
    );
    expect(card.company).toBe('Asiana Airlines');
    expect(card.booking.pnr).toBe('XKRF2M');
    expect(card.booking.flight_number).toBe('OZ212');
    expect(card.payment.last4).toBe('1087');
    expect(card.suggested_opening).toContain('OZ212');
    expect(card.suggested_opening).toContain('XKRF2M');
    expect(card.suggested_opening).toContain('0988-7234');
    expect(card.suggested_opening).toContain('920384712');
  });

  it('degrades gracefully on a null dossier (all strings present, no crash)', () => {
    const card = assembleCard(null, ctx);
    expect(card.company).toBe('Asiana Airlines');
    expect(card.booking.pnr).toBe('');
    expect(card.identity.name).toBe('');
    expect(card.suggested_opening.length).toBeGreaterThan(0);
  });
});
