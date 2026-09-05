import { Env } from './env.js';
import SCHEMA_SQL from '../schema.sql';

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

const EXPECTED_TABLES = SCHEMA_STATEMENTS.map(parseTableColumns).filter(
  (table): table is TableSchema => table !== null,
);

function columnNamesOf(createSql: string | null): Set<string> {
  const set = new Set<string>();
  const table = createSql ? parseTableColumns(createSql) : null;
  if (table) for (const column of table.columns) set.add(column.name);
  return set;
}

/**
 * Initialize a brand-new D1 database from the current schema and self-heal
 * databases created by older schema versions: missing tables are created and
 * missing columns are added via ALTER TABLE. Existing rows are never touched.
 */
export async function ensureSchema(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all<{
    name: string;
    sql: string | null;
  }>();
  const tables = new Map(existing.results.map((row) => [row.name, row.sql]));

  const alters: string[] = [];
  let missingTable = false;
  for (const expected of EXPECTED_TABLES) {
    const createSql = tables.get(expected.name);
    if (createSql === undefined) {
      missingTable = true;
      continue; // the full batch below creates it with all columns
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

  if (!missingTable && alters.length === 0) return;
  if (missingTable) await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
  for (const sql of alters) await env.DB.prepare(sql).run();
}
