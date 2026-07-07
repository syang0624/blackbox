import neo4j, { type Driver } from 'neo4j-driver';
import { config } from '../config.js';

let driver: Driver | null = null;

export function neo4jConfigured(): boolean {
  return config.neo4j.configured;
}

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.username, config.neo4j.password));
  }
  return driver;
}

export async function runWrite<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const res = await session.executeWrite((tx) => tx.run(cypher, params));
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function runRead<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const res = await session.executeRead((tx) => tx.run(cypher, params));
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

const CONSTRAINTS = [
  'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT booking_pnr IF NOT EXISTS FOR (b:Booking) REQUIRE b.pnr IS UNIQUE',
  'CREATE CONSTRAINT flight_key IF NOT EXISTS FOR (f:Flight) REQUIRE (f.number, f.date) IS UNIQUE',
  'CREATE CONSTRAINT loyalty_number IF NOT EXISTS FOR (l:LoyaltyAccount) REQUIRE l.number IS UNIQUE',
  'CREATE CONSTRAINT airport_code IF NOT EXISTS FOR (a:Airport) REQUIRE a.code IS UNIQUE',
  'CREATE CONSTRAINT airline_name IF NOT EXISTS FOR (a:Airline) REQUIRE a.name IS UNIQUE',
  'CREATE CONSTRAINT email_id IF NOT EXISTS FOR (e:Email) REQUIRE e.id IS UNIQUE',
  'CREATE CONSTRAINT attachment_tag IF NOT EXISTS FOR (t:Attachment) REQUIRE t.tag IS UNIQUE',
];

export async function initSchema(): Promise<void> {
  for (const c of CONSTRAINTS) await runWrite(c);
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
