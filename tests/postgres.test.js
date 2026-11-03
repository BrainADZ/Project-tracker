import test from 'node:test';
import assert from 'node:assert/strict';
import { openPostgres } from '../backend/models/postgres.js';
import { loadUser } from '../backend/models/access.js';
import { handle } from '../backend/controllers/api.js';
import { migrate } from '../backend/schema/setup.js';

test(
  'PostgreSQL serves migrated accounts and rolls back failed writes',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = openPostgres(process.env.DATABASE_URL);
    try {
      migrate(db);
      assert.equal(db.get("SELECT 'LIKE COLLATE NOCASE' AS sample").sample, 'LIKE COLLATE NOCASE');
      const row = db.get('SELECT id FROM users WHERE email = ?', 'web-dev1.demo@brainadz.com');
      assert.ok(row?.id);
      const user = loadUser(db, row.id);
      const services = {
        today: () => '2026-11-03',
        now: () => new Date().toISOString(),
        timeZone: 'Asia/Kolkata',
      };
      const ctx = { db, user, services, query: {}, body: {} };
      const boot = await handle(ctx, 'GET', '/bootstrap');
      assert.equal(boot.me.email, 'web-dev1.demo@brainadz.com');
      assert.ok(boot.me.username);
      assert.ok(boot.me.employee_code);
      await handle(ctx, 'GET', '/projects');
      for (const account of db.all('SELECT id FROM users WHERE active = 1')) {
        const accountCtx = { ...ctx, user: loadUser(db, account.id) };
        const accountBoot = await handle(accountCtx, 'GET', '/bootstrap');
        assert.equal(accountBoot.me.id, account.id);
        await handle(accountCtx, 'GET', '/dashboard');
      }
      const admin = db.get("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1");
      assert.ok(admin?.id);
      const adminCtx = { ...ctx, user: loadUser(db, admin.id) };
      for (const path of [
        '/projects/facets',
        '/tasks',
        '/files',
        '/groups',
        '/calendar',
        '/search',
        '/notifications',
        '/templates',
        '/admin/users',
        '/admin/verticals',
        '/daily-reporting',
        '/development-reporting/options',
        '/development-reporting/pending',
        '/marketing',
      ]) {
        await assert.doesNotReject(handle(adminCtx, 'GET', path), path);
      }
      await handle(
        { ...ctx, query: { department: 'development', date: '2026-11-03' } },
        'GET',
        '/daily-reporting',
      );
      const marker = `postgres-test-${Date.now()}`;
      assert.throws(
        () =>
          db.tx(() => {
            db.run('INSERT INTO settings(key,value) VALUES (?,?)', marker, 'temporary');
            throw new Error('rollback');
          }),
        /rollback/,
      );
      assert.equal(db.get('SELECT value FROM settings WHERE key=?', marker), undefined);
      assert.throws(
        () =>
          db.tx(() =>
            db.run(
              "INSERT INTO users(name,email,role) VALUES ('Duplicate','WEB-DEV1.DEMO@BRAINADZ.COM','member')",
            ),
          ),
        /duplicate key|unique/i,
      );
    } finally {
      await db.close();
    }
  },
);
