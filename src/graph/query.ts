import { runRead } from './neo4j.js';
import type { GraphData, GraphNode, GraphEdge, NodeType, BriefingDossier } from '../types.js';

export async function getGraph(): Promise<GraphData> {
  const nodeRows = await runRead<{ id: string; labels: string[]; props: Record<string, unknown> }>(
    'MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props',
  );
  const edgeRows = await runRead<{ id: string; source: string; target: string; type: string }>(
    'MATCH (a)-[r]->(b) RETURN elementId(r) AS id, elementId(a) AS source, elementId(b) AS target, type(r) AS type',
  );

  const nodes: GraphNode[] = nodeRows.map((r) => {
    const type = (r.labels[0] ?? 'Person') as NodeType;
    const p = r.props;
    const label = (p.name ?? p.pnr ?? p.number ?? p.code ?? p.tag ?? p.brand ?? p.subject ?? type) as string;
    return { id: r.id, type, label: String(label) };
  });
  const edges: GraphEdge[] = edgeRows.map((r) => ({ id: r.id, source: r.source, target: r.target, type: r.type }));
  return { nodes, edges };
}

export async function assembleBriefing(userId: string): Promise<BriefingDossier | null> {
  const rows = await runRead<BriefingDossier>(
    `MATCH (u:Person {id:$user})-[:HAS_BOOKING]->(b:Booking)-[:INCLUDES]->(f:Flight)
     OPTIONAL MATCH (u)-[:HAS_LOYALTY]->(l:LoyaltyAccount)
       WHERE l.airline IS NULL OR f.airline IS NULL OR l.airline = f.airline
     OPTIONAL MATCH (b)-[:PAID_WITH]->(p:PaymentMethod)
     OPTIONAL MATCH (b)-[:HAS_BAGGAGE]->(t:Attachment)
     RETURN b.pnr AS pnr, f.number AS flight_number, f.date AS date, f.route AS route, f.status AS status,
            u.name AS name, l.program AS loyalty_program, l.number AS loyalty_number,
            p.brand AS payment_brand, p.last4 AS payment_last4, t.tag AS baggage_tag
     LIMIT 1`,
    { user: userId },
  );
  return rows[0] ?? null;
}
