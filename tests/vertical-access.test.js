import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../backend/models/db.js';
import { migrate, seedBasics } from '../backend/schema/setup.js';
import { loadUser } from '../backend/models/access.js';
import { handle } from '../backend/controllers/api.js';
import { DEMO_PEOPLE, demoEmail, syncDemoHeadAccess } from '../backend/seeds/demo-seed.js';

test('vertical managers see only their team while Business Heads and CEO see every vertical', async () => {
  const db = openDb(':memory:');
  try {
    migrate(db);
    seedBasics(db);
    const verticals = Object.fromEntries(
      db
        .all("SELECT id,code FROM verticals WHERE code IN ('LIV','MKT','EXH')")
        .map((v) => [v.code, v.id]),
    );
    const users = {};
    for (const [key, code] of [
      ['live-manager', 'LIV'],
      ['marketing-manager', 'MKT'],
      ['exhibits-manager', 'EXH'],
    ]) {
      users[key] = db.run(
        'INSERT INTO users(name,email,role) VALUES (?,?,?)',
        key,
        key + '@test.local',
        'member',
      ).id;
      db.run(
        "INSERT INTO user_verticals(user_id,vertical_id,level) VALUES (?,?,'manager')",
        users[key],
        verticals[code],
      );
    }
    for (const key of ['arvind', 'kavita', 'suresh']) {
      const person = DEMO_PEOPLE.find((p) => p.key === key);
      users[key] = db.run(
        "INSERT INTO users(name,email,role,title) VALUES (?,?,'member',?)",
        person.name,
        demoEmail(key),
        person.title,
      ).id;
    }
    users.ceo = db.run(
      "INSERT INTO users(name,email,role) VALUES ('CEO','ceo@test.local','admin')",
    ).id;
    const projects = {};
    for (const [code, key] of [
      ['LIV', 'live-manager'],
      ['MKT', 'marketing-manager'],
      ['EXH', 'exhibits-manager'],
    ])
      projects[code] = db.run(
        "INSERT INTO projects(code,vertical_id,name,owner_id,status) VALUES (?,?,?,?,'active')",
        code + '-SCOPE',
        verticals[code],
        code + ' project',
        users[key],
      ).id;
    assert.ok(syncDemoHeadAccess(db) > 0);
    const context = (id, query = {}) => ({
      db,
      user: loadUser(db, id),
      body: {},
      query,
      services: { today: () => '2026-11-04', now: () => '2026-11-04T08:00:00.000Z' },
    });
    for (const [key, code] of [
      ['live-manager', 'LIV'],
      ['marketing-manager', 'MKT'],
      ['exhibits-manager', 'EXH'],
    ]) {
      const projectList = await handle(context(users[key]), 'GET', '/projects');
      assert.deepEqual(
        projectList.items.map((p) => p.id),
        [projects[code]],
      );
      const boot = await handle(context(users[key]), 'GET', '/bootstrap');
      assert.deepEqual(
        boot.verticals.map((v) => v.id),
        [verticals[code]],
      );
      const other = Object.values(projects).find((id) => id !== projects[code]);
      await assert.rejects(handle(context(users[key]), 'GET', `/projects/${other}`), /not found/);
    }
    for (const key of ['arvind', 'kavita', 'suresh', 'ceo']) {
      const projectList = await handle(context(users[key]), 'GET', '/projects');
      assert.deepEqual(
        new Set(projectList.items.map((p) => p.id)),
        new Set(Object.values(projects)),
      );
    }
  } finally {
    db.close();
  }
});
