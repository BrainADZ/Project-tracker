import test from 'node:test';
import assert from 'node:assert/strict';
import { openPostgres } from '../backend/models/postgres.js';
import { loadUser } from '../backend/models/access.js';
import { handle } from '../backend/controllers/api.js';

test('PostgreSQL serves migrated accounts and rolls back failed writes', { skip: !process.env.DATABASE_URL }, async () => {
  const db = openPostgres(process.env.DATABASE_URL);
  try {
    const row = db.get('SELECT id FROM users WHERE email = ?', 'web-dev1.demo@brainadz.com');
    assert.ok(row?.id);
    const user = loadUser(db, row.id);
    const services = { today: () => '2026-11-03', now: () => new Date().toISOString(), timeZone: 'Asia/Kolkata' };
    const ctx = { db, user, services, query: {}, body: {} };
    const boot = await handle(ctx, 'GET', '/bootstrap');
    assert.equal(boot.me.email, 'web-dev1.demo@brainadz.com');
    await handle(ctx, 'GET', '/projects');
    await handle({ ...ctx, query: { department: 'development', date: '2026-11-03' } }, 'GET', '/daily-reporting');
    const marker = `postgres-test-${Date.now()}`;
    assert.throws(() => db.tx(() => {
      db.run('INSERT INTO settings(key,value) VALUES (?,?)', marker, 'temporary');
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(db.get('SELECT value FROM settings WHERE key=?', marker), undefined);
  } finally {
    await db.close();
  }
});
