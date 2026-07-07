import { config } from '../config.js';
import { logger } from '../logger.js';

const DOCS = [
  {
    title: 'asiana-ivr-map',
    text:
      'Asiana Airlines US phone tree (1-800-227-4262). Main menu: for assistance in English press 2. ' +
      'Next menu: arrival and departure info press 1, flight schedule press 2, Asiana Club press 3, ' +
      'reservation and ticketing press 4, to speak to an agent press 5. ' +
      'Baggage submenu: for U.S. departures or arrival baggage info press 1, seat assignment press 2, ' +
      'unaccompanied minor or pets press 3, contact numbers press 4, internet support press 5, all other inquiries press 6. ' +
      'To reach a human agent for a baggage damage claim: press 2 (English) -> press 5 (agent) -> press 1 (US arrival baggage) -> ' +
      'enter Asiana Club membership number followed by star -> hold for an agent.',
  },
  {
    title: 'asiana-baggage-damage-policy',
    text:
      'Asiana Airlines damaged-baggage policy: report damage to checked baggage within 7 days of arrival. ' +
      'Have your booking reference (PNR), flight number, baggage tag number, and Asiana Club number ready. ' +
      'Damage claims for international arrivals are handled by the arrival-city baggage service office.',
  },
  {
    title: 'asiana-club-priority',
    text:
      'Asiana Club members can enter their membership number in the IVR to authenticate and expedite service. ' +
      'Higher-tier members receive shorter hold times.',
  },
];

async function main() {
  if (!config.butterbase.configured) {
    logger.error('Butterbase not configured - cannot seed RAG');
    process.exit(1);
  }
  const base = `${config.butterbase.apiUrl}/v1/${config.butterbase.appId}/rag/${config.butterbase.ragCollection}/documents`;
  for (const doc of DOCS) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.butterbase.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc.text, filename: `${doc.title}.txt`, metadata: { title: doc.title } }),
    });
    logger.info('seeded rag doc', { title: doc.title, status: res.status });
  }
}

main().catch((e) => {
  logger.error('seed failed', { error: String(e) });
  process.exit(1);
});
