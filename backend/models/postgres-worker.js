import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';

pg.types.setTypeParser(20, Number);
const client = new pg.Client({ connectionString: workerData.databaseUrl });
let ready = client.connect();

parentPort.on('message', async ({ sql, params, buffer, mode }) => {
  const state = new Int32Array(buffer, 0, 2);
  const bytes = new Uint8Array(buffer, 8);
  let result;
  try {
    await ready;
    const response = await client.query(sql, params || []);
    const query = Array.isArray(response) ? response.at(-1) : response;
    let id = null;
    if (mode === 'run' && /^\s*INSERT\b/i.test(sql) && query.rowCount) {
      try { id = Number((await client.query('SELECT lastval() AS id')).rows[0].id); } catch { /* table has no identity */ }
    }
    result = { rows: query.rows, changes: query.rowCount || 0, id };
  } catch (error) {
    result = { error: error.message, code: error.code };
  }
  const encoded = new TextEncoder().encode(JSON.stringify(result));
  if (encoded.length > bytes.length) {
    const fallback = new TextEncoder().encode(JSON.stringify({ error: 'Database result exceeds adapter buffer' }));
    bytes.set(fallback);
    Atomics.store(state, 1, fallback.length);
  } else {
    bytes.set(encoded);
    Atomics.store(state, 1, encoded.length);
  }
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
});
