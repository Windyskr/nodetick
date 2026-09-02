import { Env } from './env.js';
import SCHEMA_SQL from '../schema.sql';

const SCHEMA_STATEMENTS = SCHEMA_SQL.split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

/**
 * Initialize a brand-new D1 database from the current schema.
 *
 * Development deployments recreate the database when the schema changes, so
 * this module deliberately contains no legacy-schema compatibility logic.
 */
export async function ensureSchema(env: Env): Promise<void> {
  const ready = await env.DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first();
  if (ready) return;

  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
}
