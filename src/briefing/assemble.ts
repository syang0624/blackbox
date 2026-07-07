import type { BriefingDossier, BriefingCard } from '../types.js';

const s = (v: string | undefined): string => v ?? '';

export function buildSuggestedOpening(card: BriefingCard, baggageTag: string): string {
  const parts: string[] = ['Hi,'];
  if (card.booking.flight_number && card.booking.route) {
    parts.push(
      `I flew on ${card.company} flight ${card.booking.flight_number} from ${card.booking.route}` +
        (card.booking.date ? ` on ${card.booking.date}` : '') +
        (card.booking.pnr ? `, booking reference ${card.booking.pnr}.` : '.'),
    );
  } else if (card.booking.pnr) {
    parts.push(`I have booking reference ${card.booking.pnr} with ${card.company}.`);
  }
  parts.push('My checked suitcase was damaged during the flight and I need to file a damage claim.');
  if (baggageTag) parts.push(`My baggage tag number is ${baggageTag}.`);
  if (card.identity.loyalty_program && card.identity.loyalty_number) {
    parts.push(`My ${card.identity.loyalty_program} number is ${card.identity.loyalty_number}.`);
  }
  return parts.join(' ');
}

export function assembleCard(
  d: BriefingDossier | null,
  ctx: { company: string; intent: string; location: string; urgency: string },
): BriefingCard {
  const card: BriefingCard = {
    company: ctx.company,
    user_intent: ctx.intent,
    identity: { name: s(d?.name), loyalty_program: s(d?.loyalty_program), loyalty_number: s(d?.loyalty_number) },
    booking: {
      pnr: s(d?.pnr),
      flight_number: s(d?.flight_number),
      route: s(d?.route),
      date: s(d?.date),
      status: s(d?.status),
    },
    payment: { brand: s(d?.payment_brand), last4: s(d?.payment_last4) },
    context: { user_location: ctx.location, urgency: ctx.urgency },
    suggested_opening: '',
  };
  card.suggested_opening = buildSuggestedOpening(card, s(d?.baggage_tag));
  return card;
}
