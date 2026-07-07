import { runWrite } from './neo4j.js';
import type { ExtractedEntities, MockEmail } from '../types.js';

export const DEMO_USER_ID = 'steven-yang';

export async function ingestEmail(userId: string, email: MockEmail, e: ExtractedEntities): Promise<void> {
  await runWrite('MERGE (e:Email {id:$id}) SET e.subject=$subject, e.date=$date, e.from=$from', {
    id: email.id,
    subject: email.subject,
    date: email.date,
    from: email.from,
  });

  const personId = e.person?.id ?? userId;
  await runWrite('MERGE (p:Person {id:$id}) SET p.name=coalesce($name, p.name), p.email=coalesce($email, p.email)', {
    id: personId,
    name: e.person?.name ?? null,
    email: e.person?.email ?? null,
  });

  const airlineName = e.booking?.airline ?? e.flight?.airline ?? null;
  if (airlineName) await runWrite('MERGE (a:Airline {name:$name})', { name: airlineName });

  if (e.booking?.pnr) {
    await runWrite('MERGE (b:Booking {pnr:$pnr}) SET b.airline=coalesce($airline,b.airline)', {
      pnr: e.booking.pnr,
      airline: airlineName,
    });
    await runWrite('MATCH (p:Person {id:$u}),(b:Booking {pnr:$pnr}) MERGE (p)-[:HAS_BOOKING]->(b)', {
      u: personId,
      pnr: e.booking.pnr,
    });
  }

  if (e.flight?.number && e.flight?.date) {
    await runWrite(
      'MERGE (f:Flight {number:$n, date:$d}) SET f.route=$route, f.status=$status, f.airline=$airline, f.from=$from, f.to=$to',
      {
        n: e.flight.number,
        d: e.flight.date,
        route: e.flight.route ?? null,
        status: e.flight.status ?? null,
        airline: e.flight.airline ?? airlineName,
        from: e.flight.from ?? null,
        to: e.flight.to ?? null,
      },
    );
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(f:Flight {number:$n,date:$d}) MERGE (b)-[:INCLUDES]->(f)', {
        pnr: e.booking.pnr,
        n: e.flight.number,
        d: e.flight.date,
      });
    }
    if (airlineName) {
      await runWrite('MATCH (f:Flight {number:$n,date:$d}),(a:Airline {name:$name}) MERGE (f)-[:OPERATED_BY]->(a)', {
        n: e.flight.number,
        d: e.flight.date,
        name: airlineName,
      });
    }
    for (const [code, rel] of [
      [e.flight.from, 'DEPARTS_FROM'],
      [e.flight.to, 'ARRIVES_AT'],
    ] as const) {
      if (code) {
        await runWrite('MERGE (a:Airport {code:$c})', { c: code });
        await runWrite(`MATCH (f:Flight {number:$n,date:$d}),(a:Airport {code:$c}) MERGE (f)-[:${rel}]->(a)`, {
          n: e.flight.number,
          d: e.flight.date,
          c: code,
        });
      }
    }
  }

  if (e.loyalty?.number) {
    await runWrite('MERGE (l:LoyaltyAccount {number:$num}) SET l.program=$program, l.airline=$airline', {
      num: e.loyalty.number,
      program: e.loyalty.program ?? null,
      airline: e.loyalty.airline ?? airlineName,
    });
    await runWrite('MATCH (p:Person {id:$u}),(l:LoyaltyAccount {number:$num}) MERGE (p)-[:HAS_LOYALTY]->(l)', {
      u: personId,
      num: e.loyalty.number,
    });
  }

  if (e.payment?.last4) {
    const pkey = `${e.payment.brand ?? 'card'}-${e.payment.last4}`;
    await runWrite('MERGE (pm:PaymentMethod {key:$k}) SET pm.brand=$brand, pm.last4=$last4', {
      k: pkey,
      brand: e.payment.brand ?? null,
      last4: e.payment.last4,
    });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(pm:PaymentMethod {key:$k}) MERGE (b)-[:PAID_WITH]->(pm)', {
        pnr: e.booking.pnr,
        k: pkey,
      });
    }
  }

  if (e.baggage?.tag) {
    await runWrite('MERGE (t:Attachment {tag:$tag}) SET t.damage=coalesce($damage,t.damage)', {
      tag: e.baggage.tag,
      damage: e.baggage.damage ?? null,
    });
    if (e.booking?.pnr) {
      await runWrite('MATCH (b:Booking {pnr:$pnr}),(t:Attachment {tag:$tag}) MERGE (b)-[:HAS_BAGGAGE]->(t)', {
        pnr: e.booking.pnr,
        tag: e.baggage.tag,
      });
    }
  }
}
