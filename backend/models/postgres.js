import { Worker } from 'node:worker_threads';

// Keep the existing synchronous controller contract while pg runs on a worker.
// A single connection preserves transaction order for nested controller calls.
export function openPostgres(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const worker = new Worker(new URL('./postgres-worker.js', import.meta.url), {
    workerData: { databaseUrl },
    execArgv: [],
  });
  const buffer = new SharedArrayBuffer(16 * 1024 * 1024);
  const state = new Int32Array(buffer, 0, 2);
  const send = (sql, params = [], mode = 'query') => {
    Atomics.store(state, 0, 0);
    worker.postMessage({ sql, params, mode, buffer });
    if (Atomics.wait(state, 0, 0, 30000) === 'timed-out')
      throw new Error('PostgreSQL query timed out');
    const response = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 8, Atomics.load(state, 1))),
    );
    if (response.error) throw Object.assign(new Error(response.error), { code: response.code });
    return response;
  };
  const clean = (params) =>
    params.map((value) =>
      value === undefined ? null : typeof value === 'boolean' ? Number(value) : value,
    );
  const sql = (input) => {
    let n = 0,
      quote = '',
      result = '',
      plain = '';
    const flush = () => {
      result += plain.replace(/\bLIKE\b/gi, 'ILIKE').replace(/\s+COLLATE NOCASE\b/gi, '');
      plain = '';
    };
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quote) {
        result += c;
        if (c === quote) {
          if (input[i + 1] === quote) result += input[++i];
          else quote = '';
        }
      } else if (c === "'" || c === '"') {
        flush();
        quote = c;
        result += c;
      } else if (c === '?') plain += '$' + ++n;
      else plain += c;
    }
    flush();
    if (/^\s*INSERT OR IGNORE INTO\b/i.test(result))
      result = result
        .replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO')
        .replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
    return result;
  };
  let depth = 0;
  return {
    kind: 'postgres',
    all: (query, ...params) => send(sql(query), clean(params)).rows,
    get: (query, ...params) => send(sql(query), clean(params)).rows[0],
    run: (query, ...params) => {
      const r = send(sql(query), clean(params), 'run');
      return { id: r.id, changes: r.changes };
    },
    exec: (query) => send(sql(query)),
    tx(fn) {
      if (depth) return fn();
      depth++;
      send('BEGIN');
      try {
        const result = fn();
        send('COMMIT');
        return result;
      } catch (error) {
        send('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
    close: () => worker.terminate(),
  };
}
