import type { GraphData, BriefingCard } from '../types.js';

export const FALLBACK_CARD: BriefingCard = {
  company: 'Asiana Airlines',
  user_intent: 'File baggage damage claim',
  identity: { name: 'Steven Yang', loyalty_program: 'Asiana Club', loyalty_number: '920384712' },
  booking: { pnr: 'XKRF2M', flight_number: 'OZ212', route: 'ICN -> SFO', date: '2026-07-03', status: 'completed' },
  payment: { brand: 'American Express', last4: '1087' },
  context: { user_location: 'San Francisco', urgency: 'Suitcase broken on arrival - need damage claim filed within 7 days' },
  suggested_opening:
    'Hi, I flew on Asiana flight OZ212 from Seoul Incheon to San Francisco on July 3rd, booking reference XKRF2M. ' +
    'My checked suitcase was damaged during the flight - the handle is broken and there is a crack along the shell. ' +
    'My baggage tag number is 0988-7234. I need to file a damage claim. My Asiana Club number is 920384712.',
};

export const FALLBACK_GRAPH: GraphData = {
  nodes: [
    { id: 'Person:steven-yang', type: 'Person', label: 'Steven Yang' },
    { id: 'Booking:XKRF2M', type: 'Booking', label: 'XKRF2M' },
    { id: 'Flight:OZ212', type: 'Flight', label: 'OZ212 ICN->SFO' },
    { id: 'Airline:Asiana', type: 'Airline', label: 'Asiana Airlines' },
    { id: 'LoyaltyAccount:920384712', type: 'LoyaltyAccount', label: 'Asiana Club #920384712' },
    { id: 'PaymentMethod:amex-1087', type: 'PaymentMethod', label: 'Amex **1087' },
    { id: 'Airport:ICN', type: 'Airport', label: 'ICN' },
    { id: 'Airport:SFO', type: 'Airport', label: 'SFO' },
    { id: 'Attachment:0988-7234', type: 'Attachment', label: 'Baggage Tag #0988-7234' },
  ],
  edges: [
    { id: 'e1', source: 'Person:steven-yang', target: 'Booking:XKRF2M', type: 'HAS_BOOKING' },
    { id: 'e2', source: 'Booking:XKRF2M', target: 'Flight:OZ212', type: 'INCLUDES' },
    { id: 'e3', source: 'Flight:OZ212', target: 'Airline:Asiana', type: 'OPERATED_BY' },
    { id: 'e4', source: 'Person:steven-yang', target: 'LoyaltyAccount:920384712', type: 'HAS_LOYALTY' },
    { id: 'e5', source: 'Booking:XKRF2M', target: 'PaymentMethod:amex-1087', type: 'PAID_WITH' },
    { id: 'e6', source: 'Flight:OZ212', target: 'Airport:ICN', type: 'DEPARTS_FROM' },
    { id: 'e7', source: 'Flight:OZ212', target: 'Airport:SFO', type: 'ARRIVES_AT' },
    { id: 'e8', source: 'Booking:XKRF2M', target: 'Attachment:0988-7234', type: 'HAS_BAGGAGE' },
  ],
};
