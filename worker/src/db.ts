import { Env } from './env.js';
import SCHEMA_SQL from '../schema.sql';

/**
 * Fingerprint of schema.sql (FNV-1a). A database whose schema_meta row holds
 * it is up to date, so the check reads one row instead of all of sqlite_master.
 */
const SCHEMA_VERSION = (() => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < SCHEMA_SQL.length; i++) hash = Math.imul(hash ^ SCHEMA_SQL.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
})();

const SCHEMA_STATEMENTS = SCHEMA_SQL.split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

const CONSTRAINT_START = /^(UNIQUE|PRIMARY|FOREIGN|CHECK|CONSTRAINT)\b/i;

interface TableSchema {
  name: string;
  columns: { name: string; def: string }[];
}

/** Parse one CREATE TABLE statement into its column definitions. */
function parseTableColumns(sql: string): TableSchema | null {
  const match = /CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?\s*\(/i.exec(sql);
  if (!match) return null;
  const name = match[1];
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const columns: { name: string; def: string }[] = [];
  const push = (part: string) => {
    const def = part.trim().replace(/,+$/, '');
    if (!def) return;
    const first = def.split(/\s+/)[0];
    if (CONSTRAINT_START.test(first)) return; // table-level constraint, not a column
    columns.push({ name: first.replace(/^"|"$/g, ''), def });
  };
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  push(current);
  return { name, columns };
}

const EXPECTED_TABLES = SCHEMA_STATEMENTS.flatMap((sql) => {
  const table = parseTableColumns(sql);
  return table ? [{ ...table, sql }] : [];
});

const EXPECTED_INDEXES = SCHEMA_STATEMENTS.flatMap((sql) => {
  const match = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"?(\w+)"?/i.exec(sql);
  return match ? [{ name: match[1], sql }] : [];
});

function columnNamesOf(createSql: string | null): Set<string> {
  const set = new Set<string>();
  const table = createSql ? parseTableColumns(createSql) : null;
  if (table) for (const column of table.columns) set.add(column.name);
  return set;
}

/**
 * Bring the database up to schema.sql: create missing tables, add missing
 * columns (ALTER TABLE) and create missing indexes, in that order so an index
 * may use a column added in the same run. Existing rows are never touched.
 */
async function migrate(env: Env): Promise<void> {
  if (!fullCheck) {
    // Fails until the table exists (a brand-new database): fall through to the full check.
    const stored = await env.DB.prepare('SELECT version FROM schema_meta WHERE id = 1')
      .first<{ version: string }>()
      .catch(() => null);
    if (stored?.version === SCHEMA_VERSION) return;
  }
  const existing = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index')",
  ).all<{ type: string; name: string; sql: string | null }>();
  const tables = new Map(existing.results.filter((row) => row.type === 'table').map((row) => [row.name, row.sql]));
  const indexes = new Set(existing.results.filter((row) => row.type === 'index').map((row) => row.name));

  const creates: string[] = [];
  const alters: string[] = [];
  for (const expected of EXPECTED_TABLES) {
    const createSql = tables.get(expected.name);
    if (createSql === undefined) {
      creates.push(expected.sql);
      continue;
    }
    const present = columnNamesOf(createSql);
    for (const column of expected.columns) {
      if (present.has(column.name)) continue;
      if (/PRIMARY KEY/i.test(column.def)) continue; // cannot ADD a PK column
      let def = column.def;
      // ADD COLUMN cannot introduce NOT NULL without a backfilled default.
      if (/NOT NULL/i.test(def) && !/DEFAULT/i.test(def)) def = def.replace(/NOT NULL/i, '');
      alters.push(`ALTER TABLE ${expected.name} ADD COLUMN ${def}`);
    }
  }
  const missingIndexes = EXPECTED_INDEXES.filter((index) => !indexes.has(index.name)).map((index) => index.sql);

  if (creates.length) await env.DB.batch(creates.map((sql) => env.DB.prepare(sql)));
  for (const sql of alters) await env.DB.prepare(sql).run();
  if (missingIndexes.length) await env.DB.batch(missingIndexes.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare(
    'INSERT INTO schema_meta (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version',
  ).bind(SCHEMA_VERSION).run();
  fullCheck = false;
}

let schemaCheck: Promise<void> | null = null;
/** Skip the version shortcut once: the database lost something the version row claims. */
let fullCheck = false;

/**
 * Initialize a brand-new D1 database from the current schema and upgrade
 * databases created by older versions. Runs once per isolate (the schema only
 * changes with a deploy, which starts fresh isolates) and then costs a
 * one-row read of schema_meta, which matters for the per-minute cron that
 * often lands in a fresh isolate.
 */
export function ensureSchema(env: Env): Promise<void> {
  schemaCheck ??= migrate(env).catch((error: unknown) => {
    schemaCheck = null; // retry on the next request
    throw error;
  });
  return schemaCheck;
}

/**
 * Run the check again on the next request: after the tests reset D1, or
 * (`full`) when a query hits a missing table or column although the version
 * row says the schema is current.
 */
export function resetSchemaCheck(full = false): void {
  schemaCheck = null;
  if (full) fullCheck = true;
}

/**
 * Run statements as D1 batches of `size`. A batch counts as one query
 * against the per-request limit (50 on the Workers Free plan), so writes
 * that scale with the data never hit it. Each batch is its own transaction.
 */
export async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 500): Promise<D1Result[]> {
  const results: D1Result[] = [];
  for (let i = 0; i < statements.length; i += size) results.push(...await db.batch(statements.slice(i, i + size)));
  return results;
}
