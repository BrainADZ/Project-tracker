import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { migrate, seedBasics } from '../shared/setup.js';
import { handle } from '../shared/api.js';
import { loadUser } from '../shared/access.js';

test('employee profile fields save, load, and reject duplicate email and manager', async () => {
  const db = openDb(':memory:');
  try {
    migrate(db); seedBasics(db);
    const one = db.run("INSERT INTO users (name,email,role) VALUES ('Rajiv Malhotra','rajiv@test.local','member')").id;
    const two = db.run("INSERT INTO users (name,email,role) VALUES ('Aarav Mehta','aarav@test.local','member')").id;
    const call = (id, body) => handle({ db, user: loadUser(db, id), body, services: { today: () => '2026-11-02', now: () => '2026-11-02T00:00:00Z' } }, 'PATCH', '/me');
    const updated = await call(one, { name: 'Rajiv Malhotra', email: 'rajiv.new@test.local', phone: '9000000000', title: 'Marketing Executive', profile: { first_name: 'Rajiv', last_name: 'Malhotra', employee_id: 'BZ021', department: 'Marketing', reporting_manager_id: String(two), joining_date: '2022-04-15', annual_ctc: '7200000' } });
    assert.equal(updated.email, 'rajiv.new@test.local');
    assert.equal(updated.profile.employee_id, 'BZ021');
    assert.equal(updated.profile.annual_ctc, '7200000');
    assert.equal(loadUser(db, one).profile_data.includes('Marketing'), true);
    await assert.rejects(call(one, { email: 'aarav@test.local' }), /already in use/);
    await assert.rejects(call(one, { profile: { reporting_manager_id: String(one) } }), /valid reporting manager/);
    await assert.rejects(call(two, { profile: { employee_id: 'BZ021' } }), /employee ID is already in use/);
  } finally { db.close(); }
});
