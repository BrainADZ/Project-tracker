import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../backend/models/db.js';
import { migrate, seedBasics } from '../backend/schema/setup.js';
import { loadUser } from '../backend/models/access.js';
import { handle } from '../backend/controllers/api.js';
import { seedSeoDemo, seoDemoEmail } from '../backend/seeds/seo-demo.js';

test('SEO demo adds a manager, executive and visible work without changing repeat runs', async () => {
  const db = openDb(':memory:');
  try {
    migrate(db);
    seedBasics(db);
    const result = seedSeoDemo(db, {
      today: '2026-11-04',
      passwordHash: 'test-hash',
      now: '2026-11-04T08:00:00.000Z',
    });
    assert.equal(result.people, 2);
    assert.equal(result.tasks, 1);
    const manager = db.get('SELECT * FROM users WHERE email=?', seoDemoEmail('seo-manager'));
    const executive = db.get('SELECT * FROM users WHERE email=?', seoDemoEmail('seo-executive'));
    assert.equal(manager.password_hash, 'test-hash');
    assert.equal(executive.password_hash, 'test-hash');
    const vertical = db.get("SELECT id FROM verticals WHERE code='MKT'").id;
    assert.equal(
      db.get(
        'SELECT level FROM user_verticals WHERE user_id=? AND vertical_id=?',
        manager.id,
        vertical,
      ).level,
      'member',
    );
    const anotherProject = db.run(
      "INSERT INTO projects(code,vertical_id,name,owner_id,service_type) VALUES ('MKT-OTHER',?, 'Other Marketing project',?, 'social')",
      vertical,
      executive.id,
    ).id;
    const managerContext = {
      db,
      user: loadUser(db, manager.id),
      body: {},
      query: {},
      services: { today: () => '2026-11-04', now: () => '2026-11-04T08:00:00.000Z' },
    };
    const visible = await handle(managerContext, 'GET', '/projects');
    assert.deepEqual(
      visible.items.map((p) => p.id),
      [result.project_id],
    );
    await assert.rejects(handle(managerContext, 'GET', `/projects/${anotherProject}`), /not found/);
    const query = { department: 'seo', date: '2026-11-04' };
    const sheet = await handle(
      {
        db,
        user: loadUser(db, executive.id),
        body: {},
        query,
        services: { today: () => '2026-11-04', now: () => '2026-11-04T08:00:00.000Z' },
      },
      'GET',
      '/daily-reporting',
    );
    assert.equal(sheet.items.length, 1);
    assert.equal(sheet.items[0].project_id, result.project_id);
    assert.equal(seedSeoDemo(db, { today: '2026-11-05', passwordHash: 'different' }).added, false);
    db.run(
      "UPDATE user_verticals SET level='manager' WHERE user_id=? AND vertical_id=?",
      manager.id,
      vertical,
    );
    assert.equal(seedSeoDemo(db, { today: '2026-11-05', passwordHash: 'different' }).added, false);
    assert.equal(
      db.get(
        'SELECT level FROM user_verticals WHERE user_id=? AND vertical_id=?',
        manager.id,
        vertical,
      ).level,
      'member',
    );
    assert.equal(
      db.get('SELECT password_hash FROM users WHERE id=?', manager.id).password_hash,
      'test-hash',
    );
    assert.equal(db.get("SELECT COUNT(*) AS n FROM projects WHERE service_type='seo'").n, 1);
  } finally {
    db.close();
  }
});

test('SEO projects track monthly KPIs and keyword ranking history with scoped access', async () => {
  const db = openDb(':memory:');
  try {
    migrate(db);
    seedBasics(db);
    const vertical = db.get("SELECT id FROM verticals WHERE code='MKT'").id;
    const manager = db.run(
      "INSERT INTO users(name,email,role) VALUES ('SEO Manager','seo-manager@test.local','member')",
    ).id;
    const executive = db.run(
      "INSERT INTO users(name,email,role) VALUES ('SEO Executive','seo-exec@test.local','member')",
    ).id;
    const outsider = db.run(
      "INSERT INTO users(name,email,role) VALUES ('Outsider','seo-outsider@test.local','member')",
    ).id;
    for (const id of [manager, executive, outsider])
      db.run(
        "INSERT INTO user_verticals(user_id,vertical_id,level) VALUES (?,?,'member')",
        id,
        vertical,
      );
    const project = db.run(
      "INSERT INTO projects(code,vertical_id,name,owner_id,service_type,service_details) VALUES ('MKT-SEO-1',?, 'SEO project',?, 'seo',?)",
      vertical,
      manager,
      JSON.stringify({ specialist_id: executive, keyword_count: 10, monthly_target: 4 }),
    ).id;
    for (const id of [manager, executive])
      db.run('INSERT INTO project_members(project_id,user_id) VALUES (?,?)', project, id);
    const context = (id, body = {}, query = {}) => ({
      db,
      user: loadUser(db, id),
      body,
      query,
      services: { today: () => '2026-11-04', now: () => '2026-11-04T08:00:00.000Z' },
    });
    const path = `/projects/${project}/seo`;
    const work = await handle(
      context(manager, {
        project_id: project,
        title: 'Improve on-page metadata',
        assignee_id: executive,
        work_type: 'On-page SEO',
        report_date: '2026-11-04',
      }),
      'POST',
      '/daily-reporting',
    );
    assert.ok(work.id);
    const managerAccess = (await handle(context(manager), 'GET', '/bootstrap')).reporting_access;
    const executiveAccess = (await handle(context(executive), 'GET', '/bootstrap'))
      .reporting_access;
    assert.ok(managerAccess.departments.includes('seo'));
    assert.ok(executiveAccess.departments.includes('seo'));
    const seoSheet = await handle(
      context(manager, {}, { department: 'seo', date: '2026-11-04' }),
      'GET',
      '/daily-reporting',
    );
    assert.equal(seoSheet.department, 'seo');
    assert.equal(seoSheet.items.length, 1);
    assert.equal(seoSheet.items[0].project_id, project);
    const socialSheet = await handle(
      context(manager, {}, { department: 'social', date: '2026-11-04' }),
      'GET',
      '/daily-reporting',
    );
    assert.equal(socialSheet.items.length, 0);
    const projectView = await handle(context(manager), 'GET', `/projects/${project}`);
    assert.equal(projectView.monthly.target, 4);
    assert.equal(projectView.monthly.assigned, 1);
    assert.equal((await handle(context(executive), 'GET', path)).summary.tracked, 0);
    await assert.rejects(handle(context(outsider), 'GET', path), /not found/);
    const added = await handle(
      context(executive, {
        keyword: 'Project tracker',
        target_url: '/projects',
        search_volume: 200,
      }),
      'POST',
      path + '/keywords',
    );
    await assert.rejects(
      handle(context(executive, { keyword: 'PROJECT TRACKER' }), 'POST', path + '/keywords'),
      /already tracked/,
    );
    await handle(
      context(executive, { month: '2026-10', position: 12 }),
      'PUT',
      path + `/keywords/${added.id}/rank`,
    );
    await handle(
      context(executive, { month: '2026-11', position: 7 }),
      'PUT',
      path + `/keywords/${added.id}/rank`,
    );
    await handle(
      context(executive, {
        month: '2026-11',
        organic_sessions: 1000,
        clicks: 200,
        impressions: 5000,
        indexed_pages: 28,
        notes: 'Technical fixes completed',
      }),
      'PUT',
      path + '/report',
    );
    const current = await handle(context(manager, {}, { month: '2026-11' }), 'GET', path);
    assert.equal(current.report.organic_sessions, 1000);
    assert.equal(current.summary.top_ten, 1);
    assert.equal(current.summary.improved, 1);
    assert.equal(current.keywords[0].previous_position, 12);
    await handle(
      context(executive, { target_url: '/seo-projects', search_volume: 250 }),
      'PATCH',
      path + `/keywords/${added.id}`,
    );
    assert.equal(
      (await handle(context(manager), 'GET', path)).keywords[0].target_url,
      '/seo-projects',
    );
    await assert.rejects(
      handle(
        context(executive, { month: '2026-11', position: 0 }),
        'PUT',
        path + `/keywords/${added.id}/rank`,
      ),
      /position must be/,
    );
    await handle(context(manager), 'DELETE', path + `/keywords/${added.id}`);
    assert.equal((await handle(context(manager), 'GET', path)).summary.tracked, 0);
    db.run("UPDATE projects SET status='completed' WHERE id=?", project);
    await assert.rejects(
      handle(context(executive, { keyword: 'new term' }), 'POST', path + '/keywords'),
      /Reopen/,
    );
  } finally {
    db.close();
  }
});
