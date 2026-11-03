// One-time copy of the existing server database. SQLite is read only after
// taking a consistent backup; PostgreSQL receives all rows in one transaction.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { POSTGRES_SCHEMA } from './postgres-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceFile = path.resolve(root, process.env.DATA_DIR || 'data', 'projects.db');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const backupDir = path.join(path.dirname(sourceFile), 'backups');
mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `before-postgres-${Date.now()}.db`);
const sqlite = new DatabaseSync(sourceFile, { readOnly: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  sqlite.exec(`VACUUM INTO '${backupFile.replaceAll("'", "''")}'`);
  console.log('SQLite backup created:', backupFile);
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const sourceCounts = new Map(
    tables.map((table) => [table, sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n]),
  );
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query(POSTGRES_SCHEMA);
    const targetTables = new Set(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
        )
      ).rows.map((row) => row.table_name),
    );
    for (const table of tables)
      if (!targetTables.has(table)) throw new Error(`PostgreSQL schema is missing ${table}`);
    const users = await client.query('SELECT COUNT(*)::int AS n FROM users');
    const projects = await client.query('SELECT COUNT(*)::int AS n FROM projects');
    if (users.rows[0].n || projects.rows[0].n)
      throw new Error('PostgreSQL already contains users or projects; refusing to overwrite data');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query('DELETE FROM settings');
    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const names = columns.map((column) => `"${column}"`).join(',');
      const values = columns.map((_, index) => `$${index + 1}`).join(',');
      const statement = `INSERT INTO "${table}" (${names}) VALUES (${values})`;
      for (const row of rows)
        await client.query(
          statement,
          columns.map((column) => row[column]),
        );
      console.log(`${table}: ${rows.length} rows`);
    }
    for (const table of tables) {
      const identity = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id' AND is_identity='YES'",
        [table],
      );
      if (!identity.rowCount) continue;
      const sequence = (
        await client.query("SELECT pg_get_serial_sequence($1,'id') AS name", [`public.${table}`])
      ).rows[0].name;
      const maximum = (await client.query(`SELECT MAX(id) AS id FROM "${table}"`)).rows[0].id;
      if (maximum !== null)
        await client.query('SELECT setval($1::regclass,$2,true)', [sequence, maximum]);
    }
    for (const [table, count] of sourceCounts) {
      const result = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      if (result.rows[0].n !== count) throw new Error(`Row count mismatch for ${table}`);
    }
    await client.query('COMMIT');
    console.log('PostgreSQL migration complete; all table counts match.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
} finally {
  sqlite.close();
  await client.end().catch(() => {});
}
