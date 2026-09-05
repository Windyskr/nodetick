import { Env } from './env.js';
import SCHEMA_SQL from '../schema.sql';

const SCHEMA_STATEMENTS = SCHEMA_SQL.split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

/** Every table the current schema defines, parsed from the CREATE statements. */
const EXPECTED_TABLES = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map(
  (match) => match[1],
);

/**
 * Initialize a brand-new D1 database from the current schema. Also self-heals
 * a partially-initialized database (e.g. one created by an older schema
 * version): any missing table is created, existing rows are never touched.
 */
export async function ensureSchema(env: Env): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  const names = new Set(existing.results.map((row) => row.name));
  if (EXPECTED_TABLES.every((table) => names.has(table))) return;

  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
}
