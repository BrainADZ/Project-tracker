import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../backend/models/db.js';
import { migrate, seedBasics } from '../backend/schema/setup.js';
import { SCHEMA_VERSION } from '../backend/schema/schema.js';
import { handle } from '../backend/controllers/api.js';
import { loadUser } from '../backend/models/access.js';
import { canChooseWorkContact } from '../backend/services/project-services.js';

function fixture() {
  const db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  const mk = db.get("SELECT id FROM verticals WHERE code = 'MKT'").id;
  const lv = db.get("SELECT id FROM verticals WHERE code = 'LIV'").id;
  const add = (name, level, vertical = mk, role = 'member') => {
    const { id } = db.run(
      'INSERT INTO users (name,email,role) VALUES (?,?,?)',
      name,
      name + '@test.local',
      role,
    );
    if (level)
      db.run(
        'INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?)',
        id,
        vertical,
        level,
      );
    return id;
  };
  const manager = add('manager', 'manager'),
    designer = add('designer', 'member'),
    social = add('social', 'member'),
    viewer = add('viewer', 'viewer'),
    outsider = add('outsider', 'manager', lv);
  let now = '2026-10-30T04:30:00.000Z',
    day = '2026-10-30';
  const call = (id, method, path, body = {}, query = {}) =>
    handle(
      { db, user: loadUser(db, id), body, query, services: { today: () => day, now: () => now } },
      method,
      path,
    );
  return {
    db,
    mk,
    manager,
    designer,
    social,
    viewer,
    outsider,
    call,
    time: (v) => (now = v),
    day: (v) => (day = v),
  };
}

test('client workspace connects content, people, assets and reporting', async () => {
  const f = fixture();
  try {
    const c = await f.call(f.manager, 'POST', '/marketing/clients', {
      name: 'Comac',
      owner_id: f.manager,
      member_ids: [f.social],
      platforms: 'Instagram, Facebook',
    });
    assert.ok(c.id && c.project_id);
    const detail = await f.call(f.manager, 'GET', '/marketing/clients/' + c.id);
    assert.equal(detail.project.client, 'Comac');
    assert.ok(detail.project.members.some((u) => u.id === f.social));
    const job = await f.call(f.social, 'POST', '/marketing/jobs', {
      client_id: c.id,
      title: 'Diwali carousel',
      post_type: 'Carousel',
      social_owner_id: f.social,
      assignee_id: f.designer,
      work_date: '2026-10-30',
      due_date: '2026-10-31',
    });
    assert.equal(job.workflow, 'Not Started');
    assert.equal(job.designer_name, 'designer');
    await f.call(f.designer, 'POST', '/projects/' + c.project_id + '/files', {
      task_id: job.task_id,
      name: 'Creative draft',
      url: 'https://example.com/draft',
      category: 'Design',
    });
    assert.equal((await f.call(f.manager, 'GET', '/marketing')).jobs[0].asset_count, 1);
    const assets = await f.call(f.manager, 'GET', '/projects/' + c.project_id + '/files');
    assert.equal(assets.items[0].task_id, job.task_id);
    const mine = await f.call(f.designer, 'GET', '/tasks');
    assert.ok(mine.items.some((t) => t.id === job.task_id));
    const group = await f.call(f.designer, 'GET', '/groups/' + c.project_id);
    assert.ok(group);
    const start = await f.call(f.designer, 'PATCH', '/marketing/jobs/' + job.task_id, {
      workflow: 'Work Start',
    });
    assert.equal(start.started_at, '2026-10-30T04:30:00.000Z');
    f.time('2026-10-30T06:00:00.000Z');
    const done = await f.call(f.designer, 'PATCH', '/marketing/jobs/' + job.task_id, {
      workflow: 'Done',
    });
    assert.equal(done.task_status, 'done');
    assert.equal(done.finished_at, '2026-10-30T06:00:00.000Z');
    const reopened = await f.call(f.designer, 'PATCH', '/marketing/jobs/' + job.task_id, {
      workflow: 'Changes Requested',
    });
    assert.equal(reopened.finished_at, null);
    assert.equal(reopened.started_at, start.started_at);
    const jobDetail = await f.call(f.designer, 'GET', '/tasks/' + job.task_id);
    assert.ok(jobDetail.history.some((h) => h.detail.includes('Changes Requested')));
    await f.call(f.designer, 'PATCH', '/tasks/' + job.task_id, { status: 'done' });
    const synced = (await f.call(f.manager, 'GET', '/marketing')).jobs[0];
    assert.equal(synced.workflow, 'Done');
    assert.equal(synced.finished_at, '2026-10-30T06:00:00.000Z');
    await f.call(f.social, 'POST', '/marketing/reports', {
      client_id: c.id,
      report_date: '2026-10-30',
      accomplished: 'Drafted captions',
      blockers: 'Client approval',
    });
    await f.call(f.social, 'POST', '/marketing/reports', {
      client_id: c.id,
      report_date: '2026-10-30',
      accomplished: 'Captions approved',
    });
    const overview = await f.call(f.manager, 'GET', '/marketing');
    assert.equal(overview.reports.length, 1);
    assert.equal(overview.reports[0].accomplished, 'Captions approved');
    assert.equal(overview.clients[0].open_jobs, 0);
    await f.call(f.designer, 'POST', '/marketing/reports', {
      client_id: c.id,
      report_date: '2026-10-30',
      accomplished: 'Designer daily update',
    });
    assert.equal((await f.call(f.manager, 'GET', '/marketing')).reports.length, 2);
    assert.deepEqual(
      (await f.call(f.social, 'GET', '/marketing')).reports.map((r) => r.user_id),
      [f.social],
    );
    assert.deepEqual(
      (await f.call(f.designer, 'GET', '/marketing')).reports.map((r) => r.user_id),
      [f.designer],
    );
    const viewerReporting = await f.call(f.viewer, 'GET', '/marketing');
    assert.equal(viewerReporting.reports.length, 0);
    assert.equal(viewerReporting.jobs.length, 0);

    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
    migrate(f.db);
    assert.equal((await f.call(f.manager, 'GET', '/marketing')).clients.length, 1);
  } finally {
    f.db.close();
  }
});

test('Marketing permissions, input validation and archived-client protection', async () => {
  const f = fixture();
  try {
    const c = await f.call(f.manager, 'POST', '/marketing/clients', { name: 'Test client' });
    const job = {
      client_id: c.id,
      title: 'A reel',
      post_type: 'Video',
      work_date: '2026-10-30',
      due_date: '2026-10-31',
    };
    await assert.rejects(f.call(f.outsider, 'GET', '/marketing'), (e) => e.status === 403);
    await assert.rejects(
      f.call(f.outsider, 'GET', '/marketing/clients/' + c.id),
      (e) => e.status === 403,
    );
    assert.equal((await f.call(f.viewer, 'GET', '/marketing')).can_edit, false);
    await assert.rejects(f.call(f.viewer, 'POST', '/marketing/jobs', job), (e) => e.status === 403);
    await assert.rejects(
      f.call(f.social, 'POST', '/marketing/clients', { name: 'Forbidden' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/jobs', { ...job, assignee_id: f.outsider }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/jobs', { ...job, due_date: '2026-10-29' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/jobs', { ...job, post_type: 'Invalid' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/clients', { name: 'test CLIENT' }),
      (e) => e.status === 400,
    );
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
    const j = await f.call(f.manager, 'POST', '/marketing/jobs', job);
    await assert.rejects(
      f.call(f.manager, 'PATCH', '/marketing/jobs/' + j.task_id, { workflow: 'INVALID' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/reports', {
        client_id: c.id,
        report_date: '2026-10-31',
        accomplished: 'Future',
      }),
      (e) => e.status === 400,
    );
    await f.call(f.manager, 'PATCH', '/marketing/clients/' + c.id, {
      name: 'Test client',
      status: 'completed',
    });
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/jobs', job),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'PATCH', '/marketing/jobs/' + j.task_id, { workflow: 'Done' }),
      (e) => e.status === 400,
    );
    await f.call(f.manager, 'PATCH', '/marketing/clients/' + c.id, {
      name: 'Test client',
      status: 'active',
    });
    assert.equal((await f.call(f.manager, 'GET', '/marketing')).clients[0].status, 'active');
  } finally {
    f.db.close();
  }
});

test('client creation rolls back its project if registry insertion fails', async () => {
  const f = fixture();
  try {
    f.db.exec(
      `
        CREATE TRIGGER fail_client BEFORE INSERT ON marketing_clients BEGIN
        SELECT
          RAISE (ABORT, 'test insert failure');

        END;
      `,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/marketing/clients', { name: 'Rollback client' }),
    );
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM projects').n, 0);
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM group_messages').n, 0);
  } finally {
    f.db.close();
  }
});

test('upgrade from version 5 preserves existing project data', async () => {
  const f = fixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Existing campaign',
      client: 'Existing client',
    });
    f.db.exec(
      'DROP TABLE marketing_reports; DROP TABLE marketing_jobs; DROP TABLE marketing_clients;',
    );
    f.db.run("UPDATE settings SET value = '5' WHERE key = 'schema_version'");
    migrate(f.db);
    assert.equal(
      f.db.get('SELECT name FROM projects WHERE id = ?', p.id).name,
      'Existing campaign',
    );
    assert.equal(
      f.db.get("SELECT value FROM settings WHERE key = 'schema_version'").value,
      String(SCHEMA_VERSION),
    );
    assert.equal((await f.call(f.manager, 'GET', '/marketing')).clients.length, 0);
  } finally {
    f.db.close();
  }
});

test('clean Marketing demo contains four clients, four staff and no reporting clutter', async () => {
  const { seedMarketingDemo } = await import('../backend/seeds/marketing-demo.js');
  const f = fixture();
  try {
    const old = f.db.run(
      "INSERT INTO users (name,email,role) VALUES ('Old Marketing','kavita.rao@brainadz.com','member')",
    ).id;
    f.db.run(
      "INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,'manager')",
      old,
      f.mk,
    );
    const live = f.db.get("SELECT id FROM verticals WHERE code='LIV'").id;
    const cross = f.db.run(
      "INSERT INTO users (name,email,role) VALUES ('Cross team','siddharth.menon@brainadz.com','member')",
    ).id;
    for (const vid of [f.mk, live])
      f.db.run(
        "INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,'member')",
        cross,
        vid,
      );
    const keep = await f.call(f.outsider, 'POST', '/projects', {
      vertical_id: live,
      name: 'Keep Live project',
    });
    const before = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Old clutter',
    });
    await f.call(f.manager, 'POST', '/daily-reporting', {
      project_id: before.id,
      title: 'Old work',
      report_date: '2026-10-30',
      assignee_id: f.designer,
    });
    const result = await seedMarketingDemo(f.db, {
      today: '2026-10-30',
      passwordHash: 'demo-test',
      reset: true,
    });
    assert.equal(result.clients, 4);
    assert.equal(result.people, 4);
    assert.equal(result.jobs, 0);
    const projects = f.db.all('SELECT * FROM projects WHERE vertical_id=?', f.mk);
    assert.equal(projects.length, 4);
    assert.ok(projects.every((p) => p.service_type === 'social'));
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM daily_reporting').n, 0);
    assert.equal(
      f.db.get(
        'SELECT COUNT(*) AS n FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE vertical_id=?)',
        f.mk,
      ).n,
      0,
    );
    assert.equal(
      f.db.get('SELECT name FROM projects WHERE id=?', keep.id).name,
      'Keep Live project',
    );
    assert.equal(f.db.get('SELECT active FROM users WHERE id=?', old), undefined);
    assert.equal(f.db.get('SELECT active FROM users WHERE id=?', cross).active, 1);
    assert.ok(
      f.db.get('SELECT level FROM user_verticals WHERE user_id=? AND vertical_id=?', cross, live),
    );
    assert.equal(
      f.db.get('SELECT level FROM user_verticals WHERE user_id=? AND vertical_id=?', cross, f.mk),
      undefined,
    );
    const details = JSON.parse(projects[0].service_details);
    assert.ok(details.sales_id && details.lead_id && details.specialist_id && details.manager_id);
    assert.equal(
      f.db.get('SELECT COUNT(*) AS n FROM project_members WHERE project_id=?', projects[0].id).n,
      4,
    );
    assert.equal(
      (await seedMarketingDemo(f.db, { today: '2026-10-31', passwordHash: 'changed' })).added,
      false,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('service-specific projects store their details and include their team in the group', async () => {
  const f = fixture();
  try {
    for (const [type, details] of Object.entries({
      social: { monthly_target: 15, platforms: 'Instagram' },
      website: { website_url: 'example.com', page_count: 8, technology: 'WordPress' },
      seo: { website_url: 'example.com', keyword_count: 25, deliverables: '4 blogs' },
      ads: { platforms: 'Meta', monthly_ad_budget: 50000, objective: 'Leads' },
    })) {
      const p = await f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: type + ' project',
        client: 'Demo client',
        service_type: type,
        service_details: { ...details, lead_id: f.social, specialist_id: f.designer },
      });
      assert.equal(p.service_type, type);
      for (const [key, value] of Object.entries(details))
        assert.equal(p.service_details[key], value);
      assert.ok(
        (
          await f.call(type === 'website' ? f.designer : f.social, 'GET', '/groups/' + p.id)
        ).members.some((u) => u.id === f.designer),
      );
    }
    await assert.rejects(
      f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: 'Invalid',
        service_type: 'unknown',
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: 'Invalid',
        service_type: 'social',
        service_details: { monthly_target: -1 },
      }),
      (e) => e.status === 400,
    );
  } finally {
    f.db.close();
  }
});

test('designer timer excludes pauses, stays linked to social reporting and preserves revision time', async () => {
  const f = fixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Social retainer',
      client: 'Demo',
      status: 'active',
      service_type: 'social',
      service_details: { monthly_target: 15, lead_id: f.social, specialist_id: f.designer },
    });
    const row = await f.call(f.social, 'POST', '/daily-reporting', {
      project_id: p.id,
      title: 'Diwali carousel',
      report_date: '2026-10-30',
      work_type: 'Carousel',
      social_id: f.social,
      assignee_id: f.designer,
      remarks: 'Use the approved copy',
    });
    await assert.rejects(
      f.call(f.social, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'start' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'start' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.social, 'PATCH', '/daily-reporting/' + row.id, { status: 'Done' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.social, 'POST', '/daily-reporting', {
        project_id: p.id,
        title: 'Manual fake time',
        assignee_id: f.designer,
        start_time: '10:00',
      }),
      (e) => e.status === 400,
    );
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'start' });
    f.time('2026-10-30T05:00:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'pause' });
    f.time('2026-10-30T06:00:00.000Z');
    let report = await f.call(f.social, 'GET', '/daily-reporting');
    assert.equal(report.items[0].elapsed_ms, 30 * 60000);
    assert.equal(report.items[0].status, 'Paused');
    assert.equal(report.items[0].can_timer, false);
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', {
      action: 'resume',
    });
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', {
      action: 'resume',
    });
    f.time('2026-10-30T06:15:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'done' });
    let detail = await f.call(f.social, 'GET', '/daily-reporting/' + row.id);
    assert.equal(detail.total_ms, 45 * 60000);
    assert.equal(detail.first_started_at, '2026-10-30T04:30:00.000Z');
    assert.equal(detail.completed_at, '2026-10-30T06:15:00.000Z');
    await assert.rejects(
      f.call(f.social, 'PATCH', '/tasks/' + row.task_id, { status: 'todo' }),
      (e) => e.status === 400,
    );
    await f.call(f.social, 'POST', '/daily-reporting/' + row.id + '/notes', {
      note: 'Client reviewed the first design.',
    });
    await assert.rejects(
      f.call(f.social, 'POST', '/daily-reporting/' + row.id + '/action', {
        action: 'request_revision',
      }),
      (e) => e.status === 400,
    );
    await f.call(f.social, 'POST', '/daily-reporting/' + row.id + '/action', {
      action: 'request_revision',
      note: 'Please enlarge the logo',
    });
    detail = await f.call(f.designer, 'GET', '/daily-reporting/' + row.id);
    assert.equal(detail.status, 'Done');
    assert.equal(detail.revision_pending, 1);
    f.time('2026-10-30T06:30:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', {
      action: 'reopen',
    });
    f.time('2026-10-30T06:40:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'pause' });
    f.time('2026-10-30T07:00:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', {
      action: 'resume',
    });
    f.time('2026-10-30T07:05:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'done' });
    await f.call(f.designer, 'POST', '/daily-reporting/' + row.id + '/action', { action: 'done' });
    detail = await f.call(f.social, 'GET', '/daily-reporting/' + row.id);
    assert.equal(detail.total_ms, 60 * 60000);
    assert.equal(detail.current_revision_ms, 15 * 60000);
    assert.equal(detail.revision_no, 1);
    assert.equal(detail.sessions.length, 4);
    assert.ok(detail.notes.some((n) => n.note === 'Please enlarge the logo'));
    const project = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.equal(project.task_total, 1);
    assert.equal(project.task_done, 1);
    assert.equal(project.progress, 7);
    assert.equal(project.monthly.done, 1);
    assert.equal(project.monthly.target, 15);
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('designer can add independent extra work and cannot double-book active timers', async () => {
  const f = fixture();
  try {
    const before = f.db.get('SELECT COUNT(*) AS n FROM projects').n;
    const a = await f.call(f.designer, 'POST', '/daily-reporting', {
      title: 'Urgent print artwork',
      client_label: 'Sales team',
      work_type: 'Print',
      report_date: '2026-10-30',
    });
    const b = await f.call(f.designer, 'POST', '/daily-reporting', {
      title: 'Website banner',
      work_type: 'Website',
      report_date: '2026-10-30',
    });
    assert.ok(a.id.startsWith('extra-'));
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM projects').n, before);
    await f.call(f.designer, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'start' });
    await assert.rejects(
      f.call(f.designer, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'start' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.social, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'pause' }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.social, 'POST', '/daily-reporting/' + a.id + '/notes', {
        note: 'Unrelated feedback',
      }),
      (e) => e.status === 404,
    );
    f.time('2026-10-30T04:40:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'pause' });
    await f.call(f.designer, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'start' });
    f.time('2026-10-30T04:50:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'done' });
    const report = await f.call(f.designer, 'GET', '/daily-reporting');
    assert.equal(report.items.length, 2);
    assert.ok(report.items.every((r) => r.elapsed_ms === 600000));
    const other = await f.call(f.outsider, 'POST', '/daily-reporting', {
      title: 'Live stage drawing',
      report_date: '2026-10-30',
    });
    await assert.rejects(
      f.call(f.designer, 'GET', '/daily-reporting/' + other.id),
      (e) => e.status === 404,
    );
    assert.equal((await f.call(f.designer, 'GET', '/daily-reporting')).items.length, 2);
  } finally {
    f.db.close();
  }
});

test('work that crosses midnight appears in both daily views with accurate period totals', async () => {
  const f = fixture();
  try {
    f.time('2026-10-30T18:20:00.000Z');
    const r = await f.call(f.designer, 'POST', '/daily-reporting', {
      title: 'Late revision',
      report_date: '2026-10-30',
    });
    await f.call(f.designer, 'POST', '/daily-reporting/' + r.id + '/action', { action: 'start' });
    f.time('2026-10-30T18:40:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + r.id + '/action', { action: 'done' });
    const first = await f.call(f.designer, 'GET', '/daily-reporting', {}, { date: '2026-10-30' });
    const second = await f.call(f.designer, 'GET', '/daily-reporting', {}, { date: '2026-10-31' });
    assert.equal(first.items[0].period_ms, 600000);
    assert.equal(second.items[0].period_ms, 600000);
    assert.equal(second.items[0].total_ms, 1200000);
  } finally {
    f.db.close();
  }
});

test('existing manual reporting migrates without inventing running time', async () => {
  const f = fixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Existing reporting',
    });
    const t = await f.call(f.manager, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Older draft',
      assignee_id: f.designer,
      status: 'in_progress',
    });
    f.db.run(
      `
        INSERT INTO
          daily_reporting (
            task_id,
            report_date,
            work_type,
            social_id,
            start_time,
            status,
            remarks,
            created_by,
            updated_at
          )
        VALUES
          (
            ?,
            ?,
            'Still',
            ?,
            '10:00',
            'In Process',
            'Keep old brief',
            ?,
            ?
          )
      `,
      t.id,
      '2026-10-30',
      f.social,
      f.social,
      '2026-10-30T04:30:00.000Z',
    );
    f.db.exec(
      `
        DROP TABLE report_work_notes;

        DROP TABLE report_work_sessions;

        DROP TABLE report_work;

        DROP TABLE extra_work;
      `,
    );
    f.db.run("UPDATE settings SET value='8' WHERE key='schema_version'");
    migrate(f.db);
    const r = (await f.call(f.designer, 'GET', '/daily-reporting')).items[0];
    assert.equal(r.status, 'Paused');
    assert.ok(
      (await f.call(f.designer, 'GET', '/daily-reporting/' + r.id)).notes.some((n) =>
        n.note.includes('Earlier manual times: 10:00'),
      ),
    );
    assert.equal(r.remarks, 'Keep old brief');
    assert.equal(r.assignee_id, f.designer);
    assert.equal(r.elapsed_ms, 0);
    assert.equal(r.running_since, null);
    await f.call(f.designer, 'POST', '/daily-reporting/' + r.id + '/action', { action: 'resume' });
    f.time('2026-10-30T04:40:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + r.id + '/action', { action: 'done' });
    assert.equal((await f.call(f.social, 'GET', '/daily-reporting/' + r.id)).total_ms, 600000);
  } finally {
    f.db.close();
  }
});

test('a running timer and its notes survive database reopen', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const folder = mkdtempSync(path.join(tmpdir(), 'brainadz-work-timer-')),
    file = path.join(folder, 'test.db');
  let db = openDb(file);
  try {
    migrate(db);
    seedBasics(db);
    const vid = db.get("SELECT id FROM verticals WHERE code='MKT'").id;
    const uid = db.run(
      "INSERT INTO users (name,email,role) VALUES ('Designer','designer@timer.test','member')",
    ).id;
    db.run(
      "INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,'member')",
      uid,
      vid,
    );
    const call = (method, url, body, now) =>
      handle(
        {
          db,
          user: loadUser(db, uid),
          body,
          services: { today: () => '2026-10-30', now: () => now },
        },
        method,
        url,
      );
    const r = await call(
      'POST',
      '/daily-reporting',
      { title: 'Persistent extra design' },
      '2026-10-30T04:00:00.000Z',
    );
    await call(
      'POST',
      '/daily-reporting/' + r.id + '/action',
      { action: 'start' },
      '2026-10-30T04:00:00.000Z',
    );
    await call(
      'POST',
      '/daily-reporting/' + r.id + '/notes',
      { note: 'Keep this context' },
      '2026-10-30T04:01:00.000Z',
    );
    db.close();
    db = openDb(file);
    migrate(db);
    let detail = await call('GET', '/daily-reporting/' + r.id, {}, '2026-10-30T04:10:00.000Z');
    assert.equal(detail.elapsed_ms, 600000);
    assert.equal(detail.status, 'In Process');
    assert.ok(detail.notes.some((n) => n.note === 'Keep this context'));
    await call(
      'POST',
      '/daily-reporting/' + r.id + '/action',
      { action: 'done' },
      '2026-10-30T04:10:00.000Z',
    );
    detail = await call('GET', '/daily-reporting/' + r.id, {}, '2026-10-30T05:10:00.000Z');
    assert.equal(detail.elapsed_ms, 600000);
  } finally {
    db.close();
    const resolved = path.resolve(folder);
    // Keep cleanup guarded even when an assertion has already failed.
    if (
      !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
      !path.basename(resolved).startsWith('brainadz-work-timer-')
    )
      // eslint-disable-next-line no-unsafe-finally
      throw new Error('Unexpected test cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('only managers and project heads choose the social contact; members choose the designer', async () => {
  const f = fixture();
  try {
    const addMember = (name) => {
      const { id } = f.db.run(
        'INSERT INTO users (name,email,role) VALUES (?,?,?)',
        name,
        name + '@test.local',
        'member',
      );
      f.db.run(
        'INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?)',
        id,
        f.mk,
        'member',
      );
      return id;
    };
    const head = addMember('head'),
      otherSocial = addMember('other-social');
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Contact assignment',
      service_type: 'social',
      service_details: {
        lead_id: f.social,
        specialist_id: f.designer,
        manager_id: f.manager,
        head_id: head,
      },
    });
    const body = {
      project_id: p.id,
      title: 'New creative',
      report_date: '2026-10-30',
      assignee_id: f.designer,
    };
    const row = await f.call(f.social, 'POST', '/daily-reporting', body);
    let detail = await f.call(f.social, 'GET', '/daily-reporting/' + row.id);
    assert.equal(detail.social_id, f.social);
    assert.equal(detail.assignee_id, f.designer);
    for (const social_id of [otherSocial, f.manager, null, '']) {
      await assert.rejects(
        f.call(f.social, 'POST', '/daily-reporting', { ...body, social_id }),
        (e) => e.status === 403,
      );
      await assert.rejects(
        f.call(f.social, 'PATCH', '/daily-reporting/' + row.id, { social_id }),
        (e) => e.status === 403,
      );
    }
    await f.call(f.social, 'PATCH', '/daily-reporting/' + row.id, {
      social_id: f.social,
      remarks: 'Updated brief',
    });
    assert.equal(
      (await f.call(f.social, 'GET', '/daily-reporting/' + row.id)).remarks,
      'Updated brief',
    );
    const assigned = await f.call(f.manager, 'POST', '/daily-reporting', {
      ...body,
      social_id: otherSocial,
    });
    assert.equal(
      (await f.call(f.manager, 'GET', '/daily-reporting/' + assigned.id)).social_id,
      otherSocial,
    );
    await f.call(f.manager, 'PATCH', '/daily-reporting/' + row.id, { social_id: otherSocial });
    await assert.rejects(
      f.call(f.social, 'PATCH', '/daily-reporting/' + row.id, { title: 'Former contact edit' }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.social, 'GET', '/daily-reporting/' + row.id),
      (e) => e.status === 404,
    );
    assert.equal(
      (await f.call(otherSocial, 'GET', '/daily-reporting/' + row.id)).social_id,
      otherSocial,
    );
    // A configured head can assign contacts even with ordinary member access.
    assert.equal((await f.call(head, 'GET', '/daily-reporting/' + row.id)).can_edit, true);
    await f.call(head, 'PATCH', '/daily-reporting/' + row.id, { social_id: f.social });
    const fromHead = await f.call(head, 'POST', '/daily-reporting', {
      ...body,
      social_id: otherSocial,
    });
    assert.equal(
      (await f.call(head, 'GET', '/daily-reporting/' + fromHead.id)).social_id,
      otherSocial,
    );
    // The form uses this same rule with serialized access, rather than job-title text.
    for (const [id, expected] of [
      [f.social, false],
      [f.designer, false],
      [f.manager, true],
      [head, true],
      [f.viewer, false],
      [f.outsider, false],
    ]) {
      const user = loadUser(f.db, id);
      assert.equal(canChooseWorkContact(user, p), expected);
      assert.equal(
        canChooseWorkContact({ ...user, access: Object.fromEntries(user.access) }, p),
        expected,
      );
    }
    assert.equal(
      canChooseWorkContact(
        { ...loadUser(f.db, otherSocial), access: { [f.mk]: 'member' } },
        { ...p, service_details: { manager_id: otherSocial } },
      ),
      true,
    );
    assert.equal(
      canChooseWorkContact(
        { ...loadUser(f.db, f.viewer), access: { [f.mk]: 'viewer' } },
        { ...p, service_details: { head_id: f.viewer } },
      ),
      false,
    );
    assert.equal(canChooseWorkContact({ role: 'admin' }, p), true);
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('social retainers track monthly targets automatically without stages or auto-closing', async () => {
  const f = fixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Ongoing social',
      status: 'active',
      service_type: 'social',
      service_details: { monthly_target: 15, lead_id: f.social },
    });
    assert.deepEqual(p.stages, []);
    assert.equal(p.stage, '');
    assert.equal(p.monthly.done, 0);
    assert.equal(p.monthly.remaining, 15);
    const make = async (date) =>
      f.call(f.social, 'POST', '/daily-reporting', {
        project_id: p.id,
        title: 'Creative ' + date,
        assignee_id: f.designer,
        report_date: date,
      });
    const oct = await make('2026-10-30'),
      nov = await make('2026-11-02');
    await f.call(f.designer, 'POST', '/daily-reporting/' + oct.id + '/action', { action: 'start' });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).monthly.running, 1);
    await f.call(f.designer, 'POST', '/daily-reporting/' + oct.id + '/action', { action: 'pause' });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).monthly.paused, 1);
    f.time('2026-10-30T05:00:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + oct.id + '/action', { action: 'done' });
    let detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.equal(detail.progress, 7);
    assert.equal(detail.monthly.assigned, 1);
    assert.equal(detail.monthly.done, 1);
    assert.equal(detail.monthly.remaining, 14);
    assert.equal(detail.status, 'active');
    const list = (await f.call(f.manager, 'GET', '/projects')).items.find((x) => x.id === p.id);
    assert.deepEqual(list.monthly, detail.monthly);
    assert.equal(list.progress, 7);
    // Revisions are the same creative, and pending changes are not treated as complete.
    await f.call(f.social, 'POST', '/daily-reporting/' + oct.id + '/action', {
      action: 'request_revision',
      note: 'Update caption',
    });
    detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.equal(detail.monthly.done, 0);
    assert.equal(detail.monthly.changes_requested, 1);
    assert.equal(detail.progress, 0);
    await f.call(f.designer, 'POST', '/daily-reporting/' + oct.id + '/action', {
      action: 'reopen',
    });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).monthly.running, 1);
    await f.call(f.designer, 'POST', '/daily-reporting/' + oct.id + '/action', { action: 'done' });
    detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.equal(detail.monthly.assigned, 1);
    assert.equal(detail.monthly.done, 1);
    // New month gets its own target and keeps the previous month available.
    f.day('2026-11-03');
    f.time('2026-11-03T04:30:00.000Z');
    detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.equal(detail.monthly.month, '2026-11');
    assert.equal(detail.monthly.done, 0);
    assert.equal(detail.monthly.remaining, 15);
    assert.equal(detail.monthly.assigned, 1);
    assert.equal(detail.monthly.overdue, 1);
    await f.call(f.designer, 'POST', '/daily-reporting/' + nov.id + '/action', { action: 'start' });
    await f.call(f.designer, 'POST', '/daily-reporting/' + nov.id + '/action', { action: 'done' });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).monthly.done, 1);
    const october = await f.call(f.manager, 'GET', '/projects/' + p.id, {}, { month: '2026-10' });
    assert.equal(october.monthly.done, 1);
    assert.equal(october.monthly.assigned, 1);
    await assert.rejects(
      f.call(f.manager, 'GET', '/projects/' + p.id, {}, { month: '2026-13' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.outsider, 'GET', '/projects/' + p.id, {}, { month: '2026-10' }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.manager, 'PATCH', '/projects/' + p.id, { stage: 'Execute' }),
      (e) => e.status === 400,
    );
    await f.call(f.manager, 'PATCH', '/projects/' + p.id, {
      service_details: { monthly_target: 1, lead_id: f.social },
    });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).progress, 100);
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + p.id)).status, 'active');
  } finally {
    f.db.close();
  }
});

test('upgrade brings existing social tasks into daily reporting and preserves other services', async () => {
  const f = fixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Older social',
      service_type: 'social',
      service_details: { monthly_target: 15, lead_id: f.social },
    });
    const old = await f.call(f.manager, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Existing creative',
      assignee_id: f.designer,
      due_date: '2026-10-30',
    });
    f.db.run('DELETE FROM daily_reporting WHERE task_id=?', old.id);
    f.db.run('DELETE FROM report_work WHERE task_id=?', old.id);
    f.db.run(
      "UPDATE tasks SET status='done',stage='Execute',completed_at='2026-10-30T05:00:00.000Z' WHERE id=?",
      old.id,
    );
    f.db.run(
      "UPDATE projects SET stages=?,stage='Execute' WHERE id=?",
      JSON.stringify(['Plan', 'Execute', 'Deliver', 'Close']),
      p.id,
    );
    const web = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'SEO project',
      service_type: 'seo',
    });
    const webTask = await f.call(f.manager, 'POST', '/projects/' + web.id + '/tasks', {
      title: 'Build site',
      status: 'done',
    });
    f.db.run("UPDATE settings SET value='9' WHERE key='schema_version'");
    migrate(f.db);
    let detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.deepEqual(detail.stages, []);
    assert.equal(detail.progress, 7);
    const rows = (await f.call(f.social, 'GET', '/daily-reporting', {}, { project: p.id })).items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, old.id);
    assert.equal(rows[0].status, 'Done');
    assert.equal(rows[0].social_id, f.social);
    assert.equal(rows[0].total_ms, 0);
    assert.equal(rows[0].completed_at, '2026-10-30T05:00:00.000Z');
    migrate(f.db);
    assert.equal(
      (await f.call(f.social, 'GET', '/daily-reporting', {}, { project: p.id })).items.length,
      1,
    );
    // All future social task entry points join the same daily reporting sheet.
    const fresh = await f.call(f.social, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'New daily creative',
      assignee_id: f.designer,
      due_date: '2026-10-30',
    });
    assert.equal(
      (await f.call(f.designer, 'GET', '/tasks/' + fresh.id)).timer_managed.work_key,
      'task-' + fresh.id,
    );
    await assert.rejects(
      f.call(f.social, 'PATCH', '/tasks/' + fresh.id, { status: 'done' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.social, 'POST', '/projects/' + p.id + '/tasks', {
        title: 'Bypass timer',
        status: 'done',
      }),
      (e) => e.status === 400,
    );
    detail = await f.call(f.manager, 'GET', '/projects/' + web.id);
    assert.deepEqual(detail.stages, ['Plan', 'Execute', 'Deliver', 'Close']);
    assert.equal(detail.progress, 100);
    assert.equal(detail.monthly, undefined);
    assert.equal(
      f.db.get('SELECT task_id FROM daily_reporting WHERE task_id=?', webTask.id),
      undefined,
    );
    await f.call(f.manager, 'PATCH', '/projects/' + web.id, { stage: 'Execute' });
    assert.equal((await f.call(f.manager, 'GET', '/projects/' + web.id)).stage, 'Execute');
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

function websiteFixture() {
  const f = fixture();
  const add = (name, role = 'member', level = 'member') => {
    const { id } = f.db.run(
      'INSERT INTO users (name,email,role,title) VALUES (?,?,?,?)',
      name,
      name + '@website.test',
      role,
      name,
    );
    if (role !== 'admin')
      f.db.run(
        'INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?)',
        id,
        f.mk,
        level,
      );
    return id;
  };
  return {
    ...f,
    head: f.social,
    dev: f.designer,
    dev2: add('Developer Two'),
    sales: add('Sales'),
    unrelated: add('Other Member'),
    ceo: add('Chief Executive Officer', 'admin'),
  };
}
test('website team has one head, multiple developers and sales; CEO oversees all service projects', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Client website',
      client: 'Client',
      service_type: 'website',
      status: 'active',
      member_ids: [f.viewer, f.unrelated],
      service_details: {
        head_id: f.head,
        developer_ids: [f.dev, f.dev2, f.dev],
        sales_id: f.sales,
        website_url: 'client.example',
        page_count: 8,
        technology: 'WordPress',
      },
    });
    assert.equal(p.owner_id, f.head);
    assert.deepEqual(p.service_details.developer_ids, [f.dev, f.dev2]);
    assert.equal(p.service_details.lead_id, undefined);
    assert.equal(p.service_details.manager_id, undefined);
    const detail = await f.call(f.head, 'GET', '/projects/' + p.id);
    assert.equal(detail.permissions.edit, true);
    assert.deepEqual(
      detail.members.map((m) => m.id).sort((a, b) => a - b),
      [f.head, f.dev, f.dev2, f.sales].sort((a, b) => a - b),
    );
    assert.deepEqual(detail.stages, ['Design', 'Development', 'Testing', 'Launch']);
    for (const id of [f.head, f.dev, f.dev2, f.sales, f.ceo])
      assert.ok(await f.call(id, 'GET', '/groups/' + p.id));
    await assert.rejects(f.call(f.unrelated, 'GET', '/groups/' + p.id), (e) => e.status === 404);
    await assert.rejects(
      f.call(f.head, 'PUT', '/projects/' + p.id + '/members', {
        user_ids: [f.head, f.dev, f.dev2, f.sales, f.unrelated],
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: 'No developers',
        service_type: 'website',
        service_details: { head_id: f.head, developer_ids: [] },
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: 'Invalid developer',
        service_type: 'website',
        service_details: { head_id: f.head, developer_ids: [f.outsider] },
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.manager, 'POST', '/projects', {
        vertical_id: f.mk,
        name: 'Invalid list',
        service_type: 'website',
        service_details: { developer_ids: 'all' },
      }),
      (e) => e.status === 400,
    );
    const ids = [p.id];
    for (const type of ['social', 'seo', 'ads'])
      ids.push(
        (
          await f.call(f.manager, 'POST', '/projects', {
            vertical_id: f.mk,
            name: type,
            service_type: type,
            service_details: type === 'social' ? { monthly_target: 15 } : {},
          })
        ).id,
      );
    ids.push(
      (
        await f.call(f.outsider, 'POST', '/projects', {
          vertical_id: f.db.get("SELECT id FROM verticals WHERE code='LIV'").id,
          name: 'Live project',
        })
      ).id,
    );
    const all = (await f.call(f.ceo, 'GET', '/projects', {}, { scope: 'all' })).items.map(
      (p) => p.id,
    );
    for (const id of ids) {
      assert.ok(all.includes(id));
      assert.equal((await f.call(f.ceo, 'GET', '/projects/' + id)).permissions.edit, true);
      assert.ok(await f.call(f.ceo, 'GET', '/groups/' + id));
    }
    assert.equal((await f.call(f.ceo, 'GET', '/bootstrap')).me.role, 'admin');
    // Job titles alone never grant administrator access.
    f.db.run("UPDATE users SET title='CEO' WHERE id=?", f.unrelated);
    await assert.rejects(
      f.call(f.unrelated, 'GET', '/projects/' + ids.at(-1)),
      (e) => e.status === 404,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('website main tasks are assigned by heads while developers report daily modules and continue across days', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Website build',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev, f.dev2], sales_id: f.sales },
    });
    const a = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'UI design',
      assignee_id: f.dev,
      stage: 'Design',
      start_date: '2026-10-30',
      due_date: '2026-11-03',
    });
    const b = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Checkout development',
      assignee_id: f.dev2,
      stage: 'Development',
      due_date: '2026-11-06',
    });
    assert.deepEqual(
      (await f.call(f.dev, 'GET', '/development-reporting/options')).projects[0].tasks.map(
        (t) => t.id,
      ),
      [a.id],
    );
    assert.deepEqual(
      (await f.call(f.dev2, 'GET', '/development-reporting/options')).projects[0].tasks.map(
        (t) => t.id,
      ),
      [b.id],
    );
    assert.equal(
      (await f.call(f.head, 'GET', '/daily-reporting', {}, { department: 'development' })).items
        .length,
      0,
    );
    await assert.rejects(
      f.call(f.dev, 'POST', '/projects/' + p.id + '/tasks', {
        title: 'Unauthorized main task',
        assignee_id: f.dev,
      }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/tasks/' + a.id, { status: 'done' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/tasks/' + a.id, { title: 'Unauthorized edit' }),
      (e) => e.status === 403,
    );
    const body = {
      project_id: p.id,
      parent_task_id: a.id,
      title: 'Homepage header and mobile navigation',
      report_date: '2026-10-30',
      remarks: 'Match approved branding',
    };
    await assert.rejects(
      f.call(f.head, 'POST', '/development-reporting', { ...body, assignee_id: f.dev }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.dev2, 'POST', '/development-reporting', body),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.dev, 'POST', '/development-reporting', { ...body, report_date: '2026-11-01' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.dev, 'POST', '/development-reporting', { ...body, status: 'Done' }),
      (e) => e.status === 400,
    );
    const day1 = await f.call(f.dev, 'POST', '/development-reporting', body);
    const other = await f.call(f.dev2, 'POST', '/development-reporting', {
      ...body,
      parent_task_id: b.id,
      title: 'Checkout form',
    });
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).website.total, 2);
    await assert.rejects(
      f.call(f.dev2, 'GET', '/daily-reporting/' + day1.id),
      (e) => e.status === 404,
    );
    await f.call(f.dev, 'POST', '/daily-reporting/' + day1.id + '/action', { action: 'start' });
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + a.id, { status: 'done' }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + a.id, { assignee_id: f.dev2 }),
      (e) => e.status === 400,
    );
    f.time('2026-10-30T05:00:00.000Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + day1.id + '/action', { action: 'pause' });
    f.time('2026-10-30T05:15:00.000Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + day1.id + '/action', { action: 'resume' });
    f.time('2026-10-30T05:30:00.000Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + day1.id + '/action', {
      action: 'under_process',
    });
    let d1 = await f.call(f.dev, 'GET', '/daily-reporting/' + day1.id);
    assert.equal(d1.elapsed_ms, 45 * 60000);
    assert.equal(d1.status, 'Under process');
    assert.equal(d1.running_since, null);
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).progress, 0);
    f.day('2026-10-31');
    f.time('2026-10-31T04:30:00.000Z');
    await assert.rejects(
      f.call(f.dev, 'POST', '/daily-reporting/' + day1.id + '/action', { action: 'resume' }),
      (e) => e.status === 400,
    );
    assert.ok(
      (await f.call(f.dev, 'GET', '/development-reporting/pending')).items.some(
        (r) => r.id === day1.id,
      ),
    );
    const day2 = await f.call(f.dev, 'POST', '/development-reporting/' + day1.id + '/continue');
    assert.equal(
      (await f.call(f.dev, 'POST', '/development-reporting/' + day1.id + '/continue')).id,
      day2.id,
    );
    assert.ok(
      !(await f.call(f.dev, 'GET', '/development-reporting/pending')).items.some(
        (r) => r.id === day1.id,
      ),
    );
    let d2 = await f.call(f.dev, 'GET', '/daily-reporting/' + day2.id);
    assert.equal(d2.parent_task_id, a.id);
    assert.equal(d2.title, body.title);
    assert.equal(d2.report_date, '2026-10-31');
    assert.equal(d2.elapsed_ms, 0);
    assert.ok(d2.notes.some((n) => n.note.includes('Continued from')));
    await f.call(f.dev, 'POST', '/daily-reporting/' + day2.id + '/action', { action: 'start' });
    f.time('2026-10-31T05:00:00.000Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + day2.id + '/action', { action: 'done' });
    assert.equal(
      (await f.call(f.dev, 'GET', '/daily-reporting/' + day2.id)).elapsed_ms,
      30 * 60000,
    );
    d1 = await f.call(f.dev, 'GET', '/daily-reporting/' + day1.id);
    assert.equal(d1.elapsed_ms, 45 * 60000);
    assert.equal(d1.status, 'Under process');
    const tasks = (await f.call(f.head, 'GET', '/projects/' + p.id + '/tasks')).items;
    assert.equal(tasks.find((t) => t.id === a.id).status, 'in_progress');
    assert.equal(tasks.find((t) => t.id === a.id).elapsed_ms, 75 * 60000);
    assert.equal(tasks.find((t) => t.id === a.id).daily_entries, 2);
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).progress, 0);
    await f.call(f.head, 'PATCH', '/tasks/' + a.id, { status: 'done' });
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).progress, 50);
    await assert.rejects(
      f.call(f.dev, 'POST', '/development-reporting', body),
      (e) => e.status === 400,
    );
    await f.call(f.head, 'POST', '/daily-reporting/' + day2.id + '/action', {
      action: 'request_revision',
      note: 'Update the menu spacing',
    });
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).progress, 0);
    await f.call(f.dev, 'POST', '/daily-reporting/' + day2.id + '/action', { action: 'reopen' });
    f.time('2026-10-31T05:15:00.000Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + day2.id + '/action', { action: 'done' });
    assert.equal(
      (await f.call(f.head, 'GET', '/projects/' + p.id + '/tasks')).items.find((t) => t.id === a.id)
        .elapsed_ms,
      90 * 60000,
    );
    await f.call(f.head, 'PATCH', '/tasks/' + a.id, { status: 'done' });
    await f.call(f.head, 'PATCH', '/tasks/' + b.id, { status: 'done' });
    const project = await f.call(f.head, 'GET', '/projects/' + p.id);
    assert.equal(project.progress, 100);
    assert.equal(project.status, 'active');
    const month = (
      await f.call(
        f.head,
        'GET',
        '/daily-reporting',
        {},
        { project: p.id, scope: 'month', date: '2026-10-31' },
      )
    ).items;
    assert.equal(month.length, 3);
    assert.ok(month.every((r) => r.parent_task_id));
    assert.ok(month.every((r) => r.task_id === null));
    assert.equal(
      (await f.call(f.dev, 'GET', '/daily-reporting', {}, { department: 'development' })).items
        .length,
      1,
    );
    await f.call(f.head, 'PATCH', '/projects/' + p.id, { status: 'completed' });
    await assert.rejects(
      f.call(f.dev, 'POST', '/development-reporting', body),
      (e) => e.status === 400,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('website upgrade preserves task history and converts old single-developer teams', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Old website',
      service_type: 'website',
      service_details: {
        head_id: f.manager,
        developer_ids: [f.dev],
        sales_id: f.sales,
        website_url: 'old.example',
      },
    });
    const task = await f.call(f.manager, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Existing homepage',
      assignee_id: f.dev,
      stage: 'Development',
      due_date: '2026-11-05',
    });
    await f.call(f.manager, 'POST', '/groups/' + p.id + '/messages', {
      body: 'Keep this project history',
    });
    f.db.run('DELETE FROM daily_reporting WHERE task_id=?', task.id);
    f.db.run('DELETE FROM report_work WHERE task_id=?', task.id);
    f.db.run(
      "UPDATE tasks SET stage='Execute',status='done',completed_at='2026-10-30T06:00:00.000Z' WHERE id=?",
      task.id,
    );
    f.db.run(
      'UPDATE projects SET service_details=?,stages=?,stage=? WHERE id=?',
      JSON.stringify({
        manager_id: f.manager,
        lead_id: f.head,
        specialist_id: f.dev,
        sales_id: f.sales,
        website_url: 'old.example',
      }),
      JSON.stringify(['Plan', 'Execute', 'Deliver', 'Close']),
      'Execute',
      p.id,
    );
    f.db.run(
      'INSERT OR IGNORE INTO project_members (project_id,user_id) VALUES (?,?)',
      p.id,
      f.head,
    );
    f.db.run("UPDATE settings SET value='10' WHERE key='schema_version'");
    migrate(f.db);
    const detail = await f.call(f.manager, 'GET', '/projects/' + p.id);
    assert.deepEqual(detail.service_details.developer_ids, [f.dev]);
    assert.equal(detail.service_details.head_id, f.manager);
    assert.equal(detail.service_details.lead_id, undefined);
    assert.equal(detail.service_details.website_url, 'old.example');
    assert.ok(!detail.members.some((m) => m.id === f.head));
    assert.equal(detail.progress, 100);
    const daily = await f.call(f.dev, 'GET', '/daily-reporting/' + task.id);
    assert.equal(daily.status, 'Done');
    assert.equal(daily.social_id, null);
    assert.equal(daily.stage, 'Development');
    assert.equal(daily.total_ms, 0);
    assert.equal(daily.completed_at, '2026-10-30T06:00:00.000Z');
    assert.equal((await f.call(f.manager, 'GET', '/groups/' + p.id)).message_count, 1);
    migrate(f.db);
    assert.equal(
      f.db.get('SELECT COUNT(*) AS n FROM daily_reporting WHERE task_id=?', task.id).n,
      1,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('website heads reassign main tasks and developers add only their own linked daily work', async () => {
  const f = websiteFixture();
  try {
    const details = { head_id: f.head, developer_ids: [f.dev, f.dev2], sales_id: f.sales };
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Team changes',
      service_type: 'website',
      status: 'active',
      service_details: details,
    });
    const task = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Contact page',
      assignee_id: f.dev2,
      stage: 'Development',
      due_date: '2026-11-05',
    });
    const work = await f.call(f.dev2, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Contact form fields',
    });
    await assert.rejects(
      f.call(f.head, 'PATCH', '/projects/' + p.id, {
        service_details: { ...details, developer_ids: [f.dev] },
      }),
      (e) => e.status === 400,
    );
    await f.call(f.dev2, 'POST', '/daily-reporting/' + work.id + '/action', { action: 'start' });
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + task.id, { assignee_id: f.dev }),
      (e) => e.status === 400,
    );
    await f.call(f.dev2, 'POST', '/daily-reporting/' + work.id + '/action', {
      action: 'under_process',
    });
    await f.call(f.head, 'PATCH', '/tasks/' + task.id, { assignee_id: f.dev });
    await f.call(f.head, 'PATCH', '/projects/' + p.id, {
      service_details: { ...details, developer_ids: [f.dev] },
    });
    await assert.rejects(f.call(f.dev2, 'GET', '/groups/' + p.id), (e) => e.status === 404);
    await assert.rejects(
      f.call(f.dev2, 'POST', '/projects/' + p.id + '/tasks', {
        title: 'Removed developer task',
        assignee_id: f.dev2,
      }),
      (e) => e.status === 404,
    );
    const own = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Responsive form layout',
    });
    assert.equal(
      (await f.call(f.dev, 'GET', '/daily-reporting/' + own.id)).parent_task_id,
      task.id,
    );
    await assert.rejects(
      f.call(f.sales, 'PATCH', '/tasks/' + task.id, { priority: 'urgent' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/tasks/' + task.id, { due_date: '2026-11-20' }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + task.id, { assignee_id: f.unrelated }),
      (e) => e.status === 400,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('website demo is additive, repeatable and connects its four people to reporting', async () => {
  const { seedWebsiteDemo, WEBSITE_DEMO_PEOPLE, websiteDemoEmail } =
    await import('../backend/seeds/website-demo.js');
  const f = fixture();
  try {
    const kept = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Keep existing social',
      service_type: 'social',
      service_details: { monthly_target: 15 },
    });
    const before = f.db.get('SELECT COUNT(*) AS n FROM projects').n;
    const result = seedWebsiteDemo(f.db, {
      today: '2026-10-30',
      now: '2026-10-30T06:00:00.000Z',
      passwordHash: 'demo-hash',
    });
    assert.equal(result.added, true);
    assert.equal(result.people, 4);
    assert.equal(result.tasks, 6);
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM projects').n, before + 1);
    assert.equal(
      (await f.call(f.manager, 'GET', '/projects/' + kept.id)).name,
      'Keep existing social',
    );
    for (const person of WEBSITE_DEMO_PEOPLE) {
      const user = f.db.get('SELECT * FROM users WHERE email=?', websiteDemoEmail(person.key));
      assert.equal(user.role, 'member');
      assert.equal(user.active, 1);
      assert.equal(user.password_hash, 'demo-hash');
    }
    const head = result.accounts['web-head'],
      dev1 = result.accounts['web-dev1'],
      dev2 = result.accounts['web-dev2'];
    const detail = await f.call(head, 'GET', '/projects/' + result.project_id);
    assert.equal(detail.website.total, 6);
    assert.equal(detail.website.done, 2);
    assert.equal(detail.website.paused, 1);
    assert.equal(detail.progress, 33);
    assert.equal(detail.permissions.edit, true);
    assert.deepEqual(detail.service_details.developer_ids, [dev1, dev2]);
    assert.equal(detail.members.length, 4);
    const all = (
      await f.call(
        head,
        'GET',
        '/daily-reporting',
        {},
        { project: result.project_id, scope: 'project' },
      )
    ).items;
    assert.equal(all.length, 3);
    assert.equal(
      (await f.call(head, 'GET', '/projects/' + result.project_id + '/tasks')).items.length,
      6,
    );
    assert.equal(
      (
        await f.call(
          head,
          'GET',
          '/daily-reporting',
          {},
          { project: result.project_id, date: '2026-10-30' },
        )
      ).items.length,
      2,
    );
    assert.equal(
      f.db.get('SELECT COUNT(*) AS n FROM report_work_sessions WHERE ended_at IS NULL').n,
      0,
    );
    const paused = all.find((t) => t.status === 'Paused');
    assert.equal(paused.total_ms, 30 * 60000);
    await f.call(head, 'PATCH', '/tasks/' + paused.id, { title: 'Edited demo task' });
    assert.equal(
      seedWebsiteDemo(f.db, {
        today: '2026-10-31',
        now: '2026-10-31T06:00:00.000Z',
        passwordHash: 'do-not-overwrite',
      }).added,
      false,
    );
    assert.equal(
      (await f.call(head, 'GET', '/daily-reporting/' + paused.id)).title,
      'Edited demo task',
    );
    assert.equal(
      f.db.get('SELECT password_hash FROM users WHERE id=?', head).password_hash,
      'demo-hash',
    );
    assert.equal(f.db.get('SELECT COUNT(*) AS n FROM projects').n, before + 1);
    f.time('2026-10-30T06:00:00.000Z');
    const module = await f.call(dev1, 'POST', '/development-reporting', {
      project_id: result.project_id,
      parent_task_id: paused.id,
      title: 'Homepage product cards',
    });
    await f.call(dev1, 'POST', '/daily-reporting/' + module.id + '/action', { action: 'start' });
    f.time('2026-10-30T06:15:00.000Z');
    await f.call(dev1, 'POST', '/daily-reporting/' + module.id + '/action', { action: 'done' });
    assert.equal(
      (await f.call(head, 'GET', '/projects/' + result.project_id + '/tasks')).items.find(
        (t) => t.id === paused.id,
      ).elapsed_ms,
      45 * 60000,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('social reporting is private to the assigned content person and designer, with team oversight for managers and heads', async () => {
  const f = fixture();
  try {
    const add = (name) => {
      const { id } = f.db.run(
        'INSERT INTO users (name,email,role,title) VALUES (?,?,?,?)',
        name,
        name + '@privacy.test',
        'member',
        name,
      );
      f.db.run(
        'INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?)',
        id,
        f.mk,
        'member',
      );
      return id;
    };
    const social2 = add('Social Two'),
      designer2 = add('Designer Two'),
      head = add('Marketing Head'),
      otherHead = add('Other Head');
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Social client',
      service_type: 'social',
      service_details: {
        manager_id: f.manager,
        head_id: head,
        lead_id: f.social,
        specialist_id: f.designer,
      },
    });
    await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Separate client',
      service_type: 'social',
      service_details: { head_id: otherHead, lead_id: social2, specialist_id: designer2 },
    });
    const a = await f.call(f.manager, 'POST', '/daily-reporting', {
      project_id: p.id,
      title: 'Private creative A',
      assignee_id: f.designer,
      social_id: f.social,
      remarks: 'Private brief A',
    });
    const b = await f.call(f.manager, 'POST', '/daily-reporting', {
      project_id: p.id,
      title: 'Private creative B',
      assignee_id: designer2,
      social_id: social2,
    });
    await f.call(designer2, 'POST', '/daily-reporting/' + b.id + '/notes', {
      note: 'Private note B',
    });
    await f.call(designer2, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'start' });
    const list = (actor) =>
      f.call(
        actor,
        'GET',
        '/daily-reporting',
        {},
        { department: 'social', scope: 'month', person: designer2 },
      );
    for (const actor of [f.social, f.designer]) {
      const r = await list(actor);
      assert.deepEqual(
        r.items.map((x) => x.id),
        [a.id],
      );
      assert.equal(r.can_view_team, false);
      assert.deepEqual(
        r.member_ids.sort((a, b) => a - b),
        [f.social, f.designer].sort((a, b) => a - b),
      );
      assert.equal(r.active_work_key, null);
      for (const [method, path, body] of [
        ['GET', '/daily-reporting/' + b.id, {}],
        ['PATCH', '/daily-reporting/' + b.id, { remarks: 'tamper' }],
        ['POST', '/daily-reporting/' + b.id + '/notes', { note: 'tamper' }],
        ['POST', '/daily-reporting/' + b.id + '/action', { action: 'pause' }],
      ])
        await assert.rejects(f.call(actor, method, path, body), (e) => e.status === 404);
    }
    for (const actor of [f.manager, head]) {
      const r = await list(actor);
      assert.equal(r.items.length, 2);
      assert.equal(r.can_view_team, true);
      assert.equal(
        (await f.call(actor, 'GET', '/daily-reporting/' + b.id)).notes.some(
          (n) => n.note === 'Private note B',
        ),
        true,
      );
    }
    assert.equal((await list(otherHead)).items.length, 0);
    await assert.rejects(
      f.call(otherHead, 'GET', '/daily-reporting/' + b.id),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.viewer, 'GET', '/daily-reporting/' + a.id),
      (e) => e.status === 404,
    );
    assert.equal((await list(f.viewer)).items.length, 0);
    await f.call(f.manager, 'PATCH', '/daily-reporting/' + a.id, {
      social_id: social2,
      assignee_id: designer2,
    });
    assert.equal((await list(f.social)).items.length, 0);
    assert.equal((await list(f.designer)).items.length, 0);
    assert.equal((await list(social2)).items.length, 2);
    assert.equal((await list(designer2)).active_work_key, b.work_key);
  } finally {
    f.db.close();
  }
});

test('development and social sheets, extras, bootstrap and project views remain separate', async () => {
  const f = websiteFixture();
  try {
    f.db.run('UPDATE users SET title=? WHERE id=?', 'Frontend Developer', f.dev2);
    f.db.run('UPDATE users SET title=? WHERE id=?', 'Website Head', f.head);
    const social = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Social retainer',
      service_type: 'social',
      service_details: { lead_id: f.unrelated, specialist_id: f.designer, manager_id: f.manager },
    });
    const web = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Website',
      service_type: 'website',
      service_details: { head_id: f.head, developer_ids: [f.dev, f.dev2], sales_id: f.sales },
    });
    const s = await f.call(f.manager, 'POST', '/daily-reporting', {
      project_id: social.id,
      title: 'Social post',
      assignee_id: f.designer,
      social_id: f.unrelated,
      reporting_team: 'social',
    });
    const wt = await f.call(f.head, 'POST', '/projects/' + web.id + '/tasks', {
      title: 'Main development',
      assignee_id: f.dev2,
      stage: 'Development',
    });
    const wt2 = await f.call(f.head, 'POST', '/projects/' + web.id + '/tasks', {
      title: 'Main design',
      assignee_id: f.dev,
      stage: 'Design',
    });
    const w = await f.call(f.dev2, 'POST', '/development-reporting', {
      project_id: web.id,
      parent_task_id: wt.id,
      title: 'Web task',
    });
    const w2 = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: web.id,
      parent_task_id: wt2.id,
      title: 'Another developer task',
    });
    const se = await f.call(f.designer, 'POST', '/daily-reporting', {
      title: 'Internal design',
      reporting_team: 'social',
    });
    const we = await f.call(f.dev2, 'POST', '/daily-reporting', { title: 'Internal development' });
    assert.equal(
      f.db.get('SELECT reporting_team FROM extra_work WHERE id=?', Number(we.id.slice(6)))
        .reporting_team,
      'development',
    );
    const list = (actor, department, extra = {}) =>
      f.call(actor, 'GET', '/daily-reporting', {}, { department, ...extra });
    assert.deepEqual(
      (await list(f.manager, 'social')).items.map((r) => r.id).sort(),
      [s.id, se.id].sort(),
    );
    assert.deepEqual(
      (await list(f.manager, 'development')).items.map((r) => r.id).sort(),
      [w.id, w2.id, we.id].sort(),
    );
    assert.deepEqual(
      (await list(f.ceo, 'development')).items.map((r) => r.id).sort(),
      [w.id, w2.id, we.id].sort(),
    );
    assert.deepEqual(
      (await list(f.dev2, 'development')).items.map((r) => r.id).sort(),
      [w.id, we.id].sort(),
    );
    assert.equal((await list(f.dev2, 'development')).can_view_team, false);
    assert.equal((await list(f.head, 'development')).can_view_team, true);
    assert.deepEqual(
      (await list(f.head, 'development')).items.map((r) => r.id).sort(),
      [w.id, w2.id].sort(),
    );
    assert.equal((await list(f.dev2, 'social')).items.length, 0);
    assert.equal((await list(f.unrelated, 'development')).items.length, 0);
    assert.equal((await f.call(f.dev2, 'GET', '/daily-reporting')).department, 'development');
    assert.equal((await f.call(f.head, 'GET', '/daily-reporting')).department, 'development');
    assert.equal(
      (await list(f.head, undefined, { project: web.id, scope: 'project' })).items.length,
      2,
    );
    await assert.rejects(list(f.manager, 'social', { project: web.id }), (e) => e.status === 400);
    await assert.rejects(
      f.call(f.manager, 'GET', '/daily-reporting/' + w.id, {}, { department: 'social' }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.head, 'POST', '/daily-reporting', {
        project_id: web.id,
        title: 'Wrong sheet',
        assignee_id: f.dev,
        reporting_team: 'social',
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.dev2, 'PATCH', '/daily-reporting/' + we.id, { reporting_team: 'social' }),
      (e) => e.status === 400,
    );
    await assert.rejects(list(f.manager, 'invalid'), (e) => e.status === 400);
    assert.deepEqual((await f.call(f.dev2, 'GET', '/bootstrap')).reporting_access, {
      departments: ['development'],
      default_department: 'development',
    });
    assert.deepEqual((await f.call(f.unrelated, 'GET', '/bootstrap')).reporting_access, {
      departments: ['social'],
      default_department: 'social',
    });
    assert.deepEqual((await f.call(f.manager, 'GET', '/bootstrap')).reporting_access.departments, [
      'social',
      'development',
      'seo',
    ]);
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('version 11 extra work migrates to its reporting department without changing work history', async () => {
  const f = fixture();
  try {
    f.db.run('UPDATE users SET title=? WHERE id=?', 'Backend Developer', f.designer);
    const w = await f.call(f.designer, 'POST', '/daily-reporting', {
      title: 'Legacy development',
      reporting_team: 'social',
    });
    const s = await f.call(f.social, 'POST', '/daily-reporting', {
      title: 'Legacy social',
      reporting_team: 'social',
    });
    await f.call(f.designer, 'POST', '/daily-reporting/' + w.id + '/action', { action: 'start' });
    f.time('2026-10-30T04:45:00.000Z');
    await f.call(f.designer, 'POST', '/daily-reporting/' + w.id + '/action', { action: 'pause' });
    await f.call(f.designer, 'POST', '/daily-reporting/' + w.id + '/notes', {
      note: 'Preserve migration note',
    });
    const sessions = f.db.all('SELECT * FROM report_work_sessions'),
      notes = f.db.all('SELECT * FROM report_work_notes');
    f.db.exec('ALTER TABLE extra_work DROP COLUMN reporting_team');
    f.db.run("UPDATE settings SET value='11' WHERE key='schema_version'");
    migrate(f.db);
    assert.equal(
      f.db.get("SELECT value FROM settings WHERE key='schema_version'").value,
      String(SCHEMA_VERSION),
    );
    assert.deepEqual(f.db.all('SELECT * FROM report_work_sessions'), sessions);
    assert.deepEqual(f.db.all('SELECT * FROM report_work_notes'), notes);
    assert.equal(
      (await f.call(f.designer, 'GET', '/daily-reporting/' + w.id)).elapsed_ms,
      15 * 60000,
    );
    assert.equal((await f.call(f.designer, 'GET', '/daily-reporting')).department, 'development');
    assert.equal((await f.call(f.social, 'GET', '/daily-reporting')).items[0].id, s.id);
    const rows = f.db.all('SELECT * FROM extra_work');
    migrate(f.db);
    assert.deepEqual(f.db.all('SELECT * FROM extra_work'), rows);
    assert.equal(f.db.get('PRAGMA integrity_check').integrity_check, 'ok');
  } finally {
    f.db.close();
  }
});

test('website head only sees assigned projects across boards, search, dashboard, assets and direct links', async () => {
  const f = websiteFixture();
  try {
    const web = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Assigned website',
      client: 'Website client',
      service_type: 'website',
      status: 'active',
      health: 'off_track',
      due_date: '2026-10-31',
      service_details: { head_id: f.head, developer_ids: [f.dev], sales_id: f.sales },
    });
    const social = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Private social project',
      client: 'Social client',
      service_type: 'social',
      status: 'active',
      health: 'off_track',
      due_date: '2026-10-31',
      service_details: { lead_id: f.unrelated, specialist_id: f.unrelated, manager_id: f.manager },
    });
    const otherWeb = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Unrelated website',
      client: 'Other website client',
      service_type: 'website',
      status: 'active',
      health: 'off_track',
      due_date: '2026-10-31',
      service_details: { head_id: f.unrelated, developer_ids: [f.dev2], sales_id: f.sales },
    });
    const work = await f.call(f.head, 'POST', '/projects/' + web.id + '/tasks', {
      title: 'Assigned website task',
      assignee_id: f.dev,
      stage: 'Design',
    });
    const hidden = await f.call(f.manager, 'POST', '/daily-reporting', {
      project_id: social.id,
      title: 'Private social task',
      assignee_id: f.unrelated,
      social_id: f.unrelated,
    });
    const asset = await f.call(f.head, 'POST', '/projects/' + web.id + '/files', {
      name: 'Website brief',
      url: 'https://example.com/web',
    });
    const hiddenAsset = await f.call(f.manager, 'POST', '/projects/' + social.id + '/files', {
      name: 'Private social file',
      url: 'https://example.com/social',
    });
    await f.call(f.manager, 'POST', '/projects/' + social.id + '/milestones', {
      title: 'Private approval',
      due_date: '2026-10-31',
    });
    for (const scope of ['all', 'open'])
      assert.deepEqual(
        (await f.call(f.head, 'GET', '/projects', {}, { scope })).items.map((p) => p.id),
        [web.id],
      );
    assert.deepEqual(
      (await f.call(f.head, 'GET', '/projects', {}, { member: 'me' })).items.map((p) => p.id),
      [web.id],
    );
    assert.deepEqual((await f.call(f.head, 'GET', '/projects', {}, { q: 'Private' })).items, []);
    assert.deepEqual(
      (await f.call(f.head, 'GET', '/projects', {}, { owner: f.manager })).items,
      [],
    );
    assert.equal((await f.call(f.head, 'GET', '/projects/' + web.id)).permissions.edit, true);
    for (const id of [social.id, otherWeb.id]) {
      for (const suffix of ['', '/tasks', '/files', '/activity'])
        await assert.rejects(
          f.call(f.head, 'GET', '/projects/' + id + suffix),
          (e) => e.status === 404,
        );
      await assert.rejects(
        f.call(f.head, 'PATCH', '/projects/' + id, { name: 'Tamper' }),
        (e) => e.status === 404,
      );
      await assert.rejects(f.call(f.head, 'GET', '/groups/' + id), (e) => e.status === 404);
      await assert.rejects(
        f.call(f.head, 'GET', '/daily-reporting', {}, { project: id }),
        (e) => e.status === 404,
      );
    }
    await assert.rejects(f.call(f.head, 'GET', '/tasks/' + hidden.id), (e) => e.status === 404);
    await assert.rejects(
      f.call(f.head, 'GET', '/daily-reporting/' + hidden.id),
      (e) => e.status === 404,
    );
    await assert.rejects(
      f.call(f.head, 'POST', '/projects/' + social.id + '/files', {
        name: 'Tamper',
        url: 'https://example.com',
      }),
      (e) => e.status === 404,
    );
    assert.deepEqual(
      (await f.call(f.head, 'GET', '/tasks', {}, { scope: 'all' })).items.map((t) => t.id),
      [work.id],
    );
    const assets = await f.call(f.head, 'GET', '/files');
    assert.equal(assets.total, 1);
    assert.deepEqual(
      assets.items.map((x) => x.id),
      [asset.id],
    );
    const { fileForDownload } = await import('../backend/controllers/api.js');
    assert.throws(
      () => fileForDownload({ db: f.db, user: loadUser(f.db, f.head) }, hiddenAsset.id),
      (e) => e.status === 404,
    );
    assert.equal(
      fileForDownload({ db: f.db, user: loadUser(f.db, f.head) }, asset.id).id,
      asset.id,
    );
    assert.equal((await f.call(f.head, 'GET', '/search', {}, { q: 'Private' })).results.length, 0);
    assert.ok(
      (await f.call(f.head, 'GET', '/search', {}, { q: 'Assigned' })).results.some(
        (r) => r.type === 'project' && r.id === web.id,
      ),
    );
    assert.deepEqual(
      (await f.call(f.head, 'GET', '/projects/facets')).clients.map((c) => c.name),
      ['Website client'],
    );
    const dashboard = await f.call(f.head, 'GET', '/dashboard');
    assert.equal(dashboard.kpis.active, 1);
    assert.equal(dashboard.kpis.at_risk, 1);
    assert.equal(dashboard.by_vertical.find((v) => v.id === f.mk).open, 1);
    assert.ok(dashboard.attention.every((p) => p.id === web.id));
    assert.ok(dashboard.upcoming.every((e) => e.project.id === web.id));
    assert.ok(dashboard.activity.every((a) => a.project_id === web.id));
    const calendar = await f.call(
      f.head,
      'GET',
      '/calendar',
      {},
      { from: '2026-10-01', to: '2026-11-30' },
    );
    assert.ok(calendar.items.length);
    assert.ok(calendar.items.every((e) => e.project_id === web.id));
    const beforeNotices = (await f.call(f.head, 'GET', '/notifications')).unread;
    for (const p of [web, social])
      f.db.run(
        'INSERT INTO notifications (user_id,project_id,text,created_at) VALUES (?,?,?,?)',
        f.head,
        p.id,
        p.name,
        '2026-10-30T04:30:00Z',
      );
    const notices = await f.call(f.head, 'GET', '/notifications');
    assert.equal(notices.unread, beforeNotices + 1);
    assert.ok(notices.items.every((n) => n.project_id === web.id));
    assert.equal((await f.call(f.head, 'GET', '/bootstrap')).unread, beforeNotices + 1);
    for (const actor of [f.manager, f.ceo]) {
      assert.deepEqual(
        (await f.call(actor, 'GET', '/projects', {}, { scope: 'all' })).items
          .map((p) => p.id)
          .sort(),
        [web.id, social.id, otherWeb.id].sort(),
      );
      assert.ok(await f.call(actor, 'GET', '/projects/' + social.id));
    }
    // Explicit collaboration grants access; removing it takes effect on the next request.
    await f.call(f.manager, 'PUT', '/projects/' + social.id + '/members', {
      user_ids: [f.unrelated, f.head],
    });
    assert.ok(
      (await f.call(f.head, 'GET', '/projects', {}, { scope: 'all' })).items.some(
        (p) => p.id === social.id,
      ),
    );
    assert.ok(await f.call(f.head, 'GET', '/projects/' + social.id));
    await f.call(f.manager, 'PUT', '/projects/' + social.id + '/members', {
      user_ids: [f.unrelated],
    });
    await assert.rejects(f.call(f.head, 'GET', '/projects/' + social.id), (e) => e.status === 404);
    await f.call(f.manager, 'PATCH', '/projects/' + social.id, { status: 'completed' });
    assert.deepEqual((await f.call(f.head, 'GET', '/projects', {}, { scope: 'past' })).items, []);
    assert.equal((await f.call(f.ceo, 'GET', '/projects', {}, { scope: 'past' })).items.length, 1);
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('version 12 website histories upgrade intact and legacy work continues as a daily module', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Existing website',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev], sales_id: f.sales },
    });
    const t = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Existing UI design',
      assignee_id: f.dev,
      stage: 'Design',
    });
    f.db.run("UPDATE tasks SET status='in_progress' WHERE id=?", t.id);
    f.db.run(
      "UPDATE report_work SET state='Paused',first_started_at=? WHERE task_id=?",
      '2026-10-30T04:00:00Z',
      t.id,
    );
    f.db.run(
      `
        INSERT INTO
          report_work_sessions (
            work_key,
            user_id,
            started_at,
            ended_at,
            duration_ms
          )
        VALUES
          (?, ?, ?, ?, ?)
      `,
      'task-' + t.id,
      f.dev,
      '2026-10-30T04:00:00Z',
      '2026-10-30T04:20:00Z',
      20 * 60000,
    );
    f.db.run(
      'INSERT INTO report_work_notes (work_key,user_id,note,created_at) VALUES (?,?,?,?)',
      'task-' + t.id,
      f.head,
      'Keep this earlier feedback',
      '2026-10-30T04:20:00Z',
    );
    const tables = [
        'projects',
        'tasks',
        'daily_reporting',
        'report_work',
        'report_work_sessions',
        'report_work_notes',
      ],
      before = Object.fromEntries(
        tables.map((table) => [table, f.db.all('SELECT * FROM ' + table)]),
      );
    f.db.exec(
      `
        DROP INDEX idx_daily_continuation;

        DROP INDEX idx_extra_parent_task;

        ALTER TABLE extra_work
        DROP COLUMN parent_task_id;

        ALTER TABLE extra_work
        DROP COLUMN continued_from_key;
      `,
    );
    f.db.run("UPDATE settings SET value='12' WHERE key='schema_version'");
    migrate(f.db);
    migrate(f.db);
    for (const table of tables) assert.deepEqual(f.db.all('SELECT * FROM ' + table), before[table]);
    assert.equal(
      f.db.get("SELECT value FROM settings WHERE key='schema_version'").value,
      String(SCHEMA_VERSION),
    );
    assert.equal(
      f.db.get('SELECT COUNT(*) n FROM report_work_sessions WHERE ended_at IS NULL').n,
      0,
    );
    const old = await f.call(f.dev, 'GET', '/daily-reporting/' + t.id);
    assert.equal(old.elapsed_ms, 20 * 60000);
    assert.ok(old.notes.some((n) => n.note === 'Keep this earlier feedback'));
    await assert.rejects(
      f.call(f.dev, 'POST', '/daily-reporting/' + t.id + '/action', { action: 'resume' }),
      (e) => e.status === 400,
    );
    f.day('2026-10-31');
    f.time('2026-10-31T04:00:00Z');
    const next = await f.call(f.dev, 'POST', '/development-reporting/' + t.id + '/continue');
    assert.equal((await f.call(f.dev, 'GET', '/daily-reporting/' + next.id)).parent_task_id, t.id);
    assert.equal(
      (await f.call(f.head, 'GET', '/projects/' + p.id + '/tasks')).items[0].elapsed_ms,
      20 * 60000,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('daily module revisions and extra work continue into a new month without counting overnight gaps', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Month-end website',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev], sales_id: f.sales },
    });
    const task = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'UI design',
      assignee_id: f.dev,
      stage: 'Design',
    });
    f.day('2026-10-31');
    f.time('2026-10-31T04:00:00Z');
    const old = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Product detail module',
    });
    await f.call(f.dev, 'POST', '/daily-reporting/' + old.id + '/action', { action: 'start' });
    f.time('2026-10-31T04:10:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + old.id + '/action', { action: 'done' });
    await f.call(f.head, 'PATCH', '/tasks/' + task.id, { status: 'done' });
    f.day('2026-11-01');
    f.time('2026-11-01T04:00:00Z');
    await f.call(f.head, 'POST', '/daily-reporting/' + old.id + '/action', {
      action: 'request_revision',
      note: 'Add mobile zoom control',
    });
    assert.ok(
      (await f.call(f.dev, 'GET', '/development-reporting/pending')).items.some(
        (r) => r.id === old.id,
      ),
    );
    const revision = await f.call(f.dev, 'POST', '/development-reporting/' + old.id + '/continue');
    const detail = await f.call(f.dev, 'GET', '/daily-reporting/' + revision.id);
    assert.equal(detail.revision_no, 1);
    assert.ok(detail.notes.some((n) => n.note === 'Add mobile zoom control'));
    await f.call(f.dev, 'POST', '/daily-reporting/' + revision.id + '/action', { action: 'start' });
    f.time('2026-11-01T04:12:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + revision.id + '/action', { action: 'done' });
    assert.equal(
      (await f.call(f.head, 'GET', '/projects/' + p.id + '/tasks')).items[0].elapsed_ms,
      22 * 60000,
    );
    const october = (
      await f.call(
        f.head,
        'GET',
        '/daily-reporting',
        {},
        { department: 'development', date: '2026-10-31', scope: 'month' },
      )
    ).items;
    assert.deepEqual(
      october.map((r) => r.id),
      [old.id],
    );
    const november = (
      await f.call(
        f.head,
        'GET',
        '/daily-reporting',
        {},
        { department: 'development', date: '2026-11-01', scope: 'month' },
      )
    ).items;
    assert.deepEqual(
      november.map((r) => r.id),
      [revision.id],
    );
    const extra = await f.call(f.dev, 'POST', '/daily-reporting', {
      title: 'Internal deployment support',
      reporting_team: 'development',
    });
    await f.call(f.dev, 'POST', '/daily-reporting/' + extra.id + '/action', { action: 'start' });
    f.time('2026-11-01T04:22:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + extra.id + '/action', {
      action: 'under_process',
    });
    f.day('2026-11-02');
    f.time('2026-11-02T04:00:00Z');
    assert.ok(
      (await f.call(f.dev, 'GET', '/development-reporting/pending')).items.some(
        (r) => r.id === extra.id,
      ),
    );
    const next = await f.call(f.dev, 'POST', '/development-reporting/' + extra.id + '/continue');
    assert.equal(
      (await f.call(f.dev, 'POST', '/development-reporting/' + extra.id + '/continue')).id,
      next.id,
    );
    assert.equal(
      (await f.call(f.dev, 'GET', '/daily-reporting/' + extra.id)).elapsed_ms,
      10 * 60000,
    );
    assert.equal((await f.call(f.dev, 'GET', '/daily-reporting/' + next.id)).elapsed_ms, 0);
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).website.total, 1);
  } finally {
    f.db.close();
  }
});

test('developer submits completed modules, head reviews, and approval updates project progress', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Review website',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev, f.dev2], sales_id: f.sales },
    });
    const main = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'UI design',
      assignee_id: f.dev,
      stage: 'Design',
    });
    await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Backend',
      assignee_id: f.dev2,
      stage: 'Development',
    });
    const create = (title) =>
      f.call(f.dev, 'POST', '/development-reporting', {
        project_id: p.id,
        parent_task_id: main.id,
        title,
      });
    const submit = (body) =>
      f.call(f.dev, 'POST', '/tasks/' + main.id + '/submit-review', {
        all_modules_complete: true,
        ...body,
      });
    const original = await create('Mobile navigation');
    await f.call(f.dev, 'POST', '/daily-reporting/' + original.id + '/action', { action: 'start' });
    f.time('2026-10-30T05:00:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + original.id + '/action', {
      action: 'under_process',
    });
    f.day('2026-10-31');
    f.time('2026-10-31T04:30:00Z');
    const continuation = await f.call(
      f.dev,
      'POST',
      '/development-reporting/' + original.id + '/continue',
    );
    await f.call(f.dev, 'POST', '/daily-reporting/' + continuation.id + '/action', {
      action: 'start',
    });
    f.time('2026-10-31T05:00:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + continuation.id + '/action', {
      action: 'done',
    });
    const t = await f.call(f.dev, 'GET', '/tasks/' + main.id);
    assert.equal(t.review.can_submit, true);
    assert.equal(t.review.pending_modules, 0);
    assert.equal(t.permissions.edit, false);
    assert.equal(t.permissions.work, true);
    const workDetails = {
      description: 'All screens tested on mobile and desktop.',
      checklist: [{ text: 'Mobile layout verified', done: true }],
    };
    await f.call(f.dev, 'PATCH', '/tasks/' + main.id, workDetails);
    const headDetails = await f.call(f.head, 'GET', '/tasks/' + main.id);
    assert.equal(headDetails.description, workDetails.description);
    assert.deepEqual(headDetails.checklist, workDetails.checklist);
    for (const actor of [f.dev2, f.sales]) {
      assert.equal((await f.call(actor, 'GET', '/tasks/' + main.id)).permissions.work, false);
      await assert.rejects(
        f.call(actor, 'PATCH', '/tasks/' + main.id, workDetails),
        (e) => e.status === 403,
      );
    }
    for (const body of [
      { status: 'done' },
      { assignee_id: f.dev2 },
      { title: 'Changed title' },
      { priority: 'high' },
      { due_date: '2026-11-10' },
      { description: 'Allowed field', status: 'done' },
    ])
      await assert.rejects(
        f.call(f.dev, 'PATCH', '/tasks/' + main.id, body),
        (e) => e.status === 403,
      );
    assert.ok(
      (await f.call(f.dev, 'GET', '/development-reporting/options')).projects[0].review_tasks.some(
        (t) => t.id === main.id && t.review.can_submit,
      ),
    );
    await assert.rejects(submit({ preview_url: 'javascript:alert(1)' }), (e) => e.status === 400);
    const a = await submit({
      note: 'All modules complete; tested on mobile and desktop.',
      preview_url: 'https://preview.example/ui',
    });
    assert.equal((await submit({})).review_id, a.review_id);
    assert.equal(f.db.get('SELECT COUNT(*) n FROM website_task_reviews').n, 1);
    let task = await f.call(f.dev, 'GET', '/tasks/' + main.id);
    assert.equal(task.status, 'review');
    assert.equal(task.review.latest.preview_url, 'https://preview.example/ui');
    assert.equal(task.review.can_submit, false);
    assert.equal(task.permissions.work, false);
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/tasks/' + main.id, workDetails),
      (e) => e.status === 403,
    );
    let project = await f.call(f.head, 'GET', '/projects/' + p.id);
    assert.equal(project.progress, 0);
    assert.equal(project.website.ready_for_review, 1);
    assert.ok(
      f.db.get(
        "SELECT id FROM notifications WHERE user_id=? AND task_id=? AND text LIKE '%submitted%'",
        f.head,
        main.id,
      ),
    );
    assert.ok(
      !(await f.call(f.dev, 'GET', '/development-reporting/options')).projects[0].tasks.some(
        (t) => t.id === main.id,
      ),
    );
    assert.equal((await f.call(f.head, 'GET', '/tasks/' + main.id)).review.can_review, true);
    assert.equal((await f.call(f.dev2, 'GET', '/tasks/' + main.id)).review.can_review, false);
    await assert.rejects(create('Extra module during review'), (e) => e.status === 400);
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/daily-reporting/' + continuation.id, {
        title: 'Change submitted module',
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.dev, 'POST', '/daily-reporting/' + continuation.id + '/action', {
        action: 'reopen',
        note: 'Mutating submitted work',
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.head, 'POST', '/daily-reporting/' + continuation.id + '/action', {
        action: 'request_revision',
        note: 'Use review feedback instead',
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + main.id, { status: 'done', reviewTransition: true }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      f.call(f.head, 'PATCH', '/tasks/' + main.id, { assignee_id: f.dev2 }),
      (e) => e.status === 400,
    );
    const approve = { review_id: a.review_id, decision: 'approve' };
    for (const actor of [f.dev, f.dev2, f.sales])
      await assert.rejects(
        f.call(actor, 'POST', '/tasks/' + main.id + '/review', approve),
        (e) => e.status === 403,
      );
    await f.call(f.head, 'POST', '/tasks/' + main.id + '/review', approve);
    assert.equal(
      (await f.call(f.head, 'POST', '/tasks/' + main.id + '/review', approve)).already_reviewed,
      true,
    );
    task = await f.call(f.dev, 'GET', '/tasks/' + main.id);
    assert.equal(task.status, 'done');
    assert.equal(task.review.latest.status, 'approved');
    assert.equal(task.review.latest.reviewed_by, f.head);
    assert.equal(task.permissions.work, false);
    await assert.rejects(
      f.call(f.dev, 'PATCH', '/tasks/' + main.id, workDetails),
      (e) => e.status === 403,
    );
    assert.equal(task.review.history.length, 1);
    project = await f.call(f.head, 'GET', '/projects/' + p.id);
    assert.equal(project.progress, 50);
    assert.equal(project.website.ready_for_review, 0);
    assert.equal(project.website.done, 1);
    assert.ok(
      f.db.get(
        "SELECT id FROM notifications WHERE user_id=? AND task_id=? AND text LIKE '%approved%'",
        f.dev,
        main.id,
      ),
    );
    assert.equal(
      (await f.call(f.head, 'GET', '/projects/' + p.id + '/tasks')).items.find(
        (t) => t.id === main.id,
      ).elapsed_ms,
      60 * 60000,
    );
    await assert.rejects(submit({}), (e) => e.status === 400);
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
  } finally {
    f.db.close();
  }
});

test('task review validates current modules and confirmation, requires rejection feedback, and preserves review rounds', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Review validation',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev, f.dev2], sales_id: f.sales },
    });
    const task = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Checkout',
      assignee_id: f.dev,
      stage: 'Development',
    });
    const path = '/tasks/' + task.id;
    const submit = (actor = f.dev, body = { all_modules_complete: true }) =>
      f.call(actor, 'POST', path + '/submit-review', body);
    for (const actor of [f.head, f.dev2, f.sales])
      await assert.rejects(submit(actor), (e) => e.status === 403);
    await assert.rejects(submit(f.outsider), (e) => e.status === 404);
    await assert.rejects(submit(), (e) => e.status === 400);
    const a = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Checkout address form',
    });
    await assert.rejects(submit(), (e) => e.status === 400);
    await f.call(f.dev, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'start' });
    await assert.rejects(submit(), (e) => e.status === 400 && e.message.includes('timers'));
    await f.call(f.dev, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'pause' });
    await assert.rejects(submit(), (e) => e.status === 400 && e.message.includes('current module'));
    await f.call(f.dev, 'POST', '/daily-reporting/' + a.id + '/action', { action: 'done' });
    await assert.rejects(submit(f.dev, { all_modules_complete: false }), (e) => e.status === 400);
    await assert.rejects(submit(f.dev, {}), (e) => e.status === 400);
    const b = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Payment form',
    });
    await assert.rejects(submit(), (e) => e.status === 400);
    await f.call(f.dev, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'start' });
    await f.call(f.dev, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'done' });
    await f.call(f.dev, 'PATCH', path, {
      description: 'Checkout address and payment forms tested.',
    });
    const first = await submit();
    assert.equal(
      (await f.call(f.head, 'GET', path)).review.latest.note,
      'Checkout address and payment forms tested.',
    );
    await assert.rejects(
      f.call(f.head, 'POST', path + '/review', {
        decision: 'changes_required',
        review_id: first.review_id,
        feedback: '  ',
      }),
      (e) => e.status === 400,
    );
    assert.equal((await f.call(f.head, 'GET', path)).status, 'review');
    await f.call(f.head, 'POST', path + '/review', {
      decision: 'changes_required',
      review_id: first.review_id,
      feedback: 'Fix mobile checkout validation',
    });
    let detail = await f.call(f.dev, 'GET', path);
    assert.equal(detail.status, 'in_progress');
    assert.equal(detail.review.latest.feedback, 'Fix mobile checkout validation');
    assert.equal(detail.permissions.work, true);
    await f.call(f.dev, 'PATCH', path, { description: 'Addressing the head review feedback.' });
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).website.changes_requested, 1);
    assert.ok(
      f.db.get(
        "SELECT id FROM notifications WHERE user_id=? AND text LIKE '%Fix mobile checkout validation%'",
        f.dev,
      ),
    );
    await f.call(f.dev, 'POST', '/daily-reporting/' + b.id + '/action', {
      action: 'reopen',
      note: 'Fixing review feedback',
    });
    await assert.rejects(submit(), (e) => e.status === 400);
    f.time('2026-10-30T04:40:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + b.id + '/action', { action: 'done' });
    const second = await submit(f.dev, {
      all_modules_complete: true,
      note: 'Fixed validation and retested.',
    });
    assert.notEqual(second.review_id, first.review_id);
    await assert.rejects(
      f.call(f.head, 'POST', path + '/review', { review_id: first.review_id, decision: 'approve' }),
      (e) => e.status === 400,
    );
    assert.equal((await f.call(f.dev, 'GET', path)).status, 'review');
    await f.call(f.ceo, 'POST', path + '/review', {
      review_id: second.review_id,
      decision: 'approve',
    });
    detail = await f.call(f.dev, 'GET', path);
    assert.equal(detail.status, 'done');
    assert.equal(detail.review.history.length, 2);
    assert.equal(detail.review.history[0].reviewed_by, f.ceo);
    assert.equal(detail.review.history[1].feedback, 'Fix mobile checkout validation');
    assert.equal((await f.call(f.head, 'GET', '/projects/' + p.id)).progress, 100);
    const attempts = f.db.all('SELECT id,task_id,status FROM website_task_reviews');
    await f.call(f.head, 'PATCH', '/projects/' + p.id, { status: 'completed' });
    await assert.rejects(submit(), (e) => e.status === 400);
    assert.deepEqual(f.db.all('SELECT id,task_id,status FROM website_task_reviews'), attempts);
  } finally {
    f.db.close();
  }
});

test('task submission rolls back status and review history if notification fails', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Atomic review',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev], sales_id: f.sales },
    });
    const task = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Homepage',
      assignee_id: f.dev,
      stage: 'Design',
    });
    const day = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Homepage layout',
    });
    await f.call(f.dev, 'POST', '/daily-reporting/' + day.id + '/action', { action: 'start' });
    await f.call(f.dev, 'POST', '/daily-reporting/' + day.id + '/action', { action: 'done' });
    const activities = f.db.get('SELECT COUNT(*) n FROM activity').n;
    f.db.exec(
      `
        CREATE TRIGGER fail_review_notice BEFORE INSERT ON notifications WHEN NEW.text LIKE '%submitted%' BEGIN
        SELECT
          RAISE (ABORT, 'test notification failure');

        END;
      `,
    );
    await assert.rejects(
      f.call(f.dev, 'POST', '/tasks/' + task.id + '/submit-review', { all_modules_complete: true }),
    );
    assert.equal(f.db.get('SELECT COUNT(*) n FROM website_task_reviews').n, 0);
    assert.equal((await f.call(f.dev, 'GET', '/tasks/' + task.id)).status, 'in_progress');
    assert.equal(f.db.get('SELECT COUNT(*) n FROM activity').n, activities);
    f.db.exec('DROP TRIGGER fail_review_notice;');
    const result = await f.call(f.dev, 'POST', '/tasks/' + task.id + '/submit-review', {
      all_modules_complete: true,
    });
    assert.ok(result.review_id);
  } finally {
    f.db.close();
  }
});

test('version 13 upgrade preserves daily work and creates an empty task-review history', async () => {
  const f = websiteFixture();
  try {
    const p = await f.call(f.manager, 'POST', '/projects', {
      vertical_id: f.mk,
      name: 'Existing development',
      service_type: 'website',
      status: 'active',
      service_details: { head_id: f.head, developer_ids: [f.dev], sales_id: f.sales },
    });
    const task = await f.call(f.head, 'POST', '/projects/' + p.id + '/tasks', {
      title: 'Existing task',
      assignee_id: f.dev,
      stage: 'Design',
    });
    const daily = await f.call(f.dev, 'POST', '/development-reporting', {
      project_id: p.id,
      parent_task_id: task.id,
      title: 'Existing module',
    });
    await f.call(f.dev, 'POST', '/daily-reporting/' + daily.id + '/action', { action: 'start' });
    f.time('2026-10-30T05:00:00Z');
    await f.call(f.dev, 'POST', '/daily-reporting/' + daily.id + '/action', { action: 'done' });
    const tables = [
        'projects',
        'tasks',
        'extra_work',
        'daily_reporting',
        'report_work',
        'report_work_sessions',
        'report_work_notes',
      ],
      before = Object.fromEntries(tables.map((t) => [t, f.db.all('SELECT * FROM ' + t)]));
    f.db.exec('DROP TABLE website_task_reviews');
    f.db.run("UPDATE settings SET value='13' WHERE key='schema_version'");
    migrate(f.db);
    migrate(f.db);
    for (const t of tables) assert.deepEqual(f.db.all('SELECT * FROM ' + t), before[t]);
    assert.equal(f.db.get('SELECT COUNT(*) n FROM website_task_reviews').n, 0);
    const main = await f.call(f.dev, 'GET', '/tasks/' + task.id);
    assert.equal(main.review.latest, null);
    assert.equal(main.review.can_submit, true);
    assert.equal(
      (await f.call(f.dev, 'GET', '/daily-reporting/' + daily.id)).elapsed_ms,
      30 * 60000,
    );
    assert.equal(f.db.get('PRAGMA foreign_key_check'), undefined);
    assert.equal(
      f.db.get("SELECT value FROM settings WHERE key='schema_version'").value,
      String(SCHEMA_VERSION),
    );
  } finally {
    f.db.close();
  }
});
