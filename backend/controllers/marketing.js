import { bad, forbidden, notFound, text, optDate, optId, toId, oneOf } from '../services/util.js';
import { atLeast, canManageVertical, loadUser, canView, projectVisibilitySql } from '../models/access.js';
import { canReadWork, canManageReport } from '../services/reporting-access.js';
import { POST_TYPES, PLATFORMS, JOB_STATUSES, TASK_STATE, CLOSED_JOBS } from '../services/marketing-options.js';

function marketing(ctx, write = false, manage = false) {
  const v = ctx.db.get("SELECT * FROM verticals WHERE code = 'MKT' AND active = 1");
  if (!v || !atLeast(ctx.user, v.id, 'viewer')) throw forbidden('Marketing access is required');
  if (write && !atLeast(ctx.user, v.id, 'member')) throw forbidden('You have view-only Marketing access');
  if (manage && !canManageVertical(ctx.user, v.id)) throw forbidden('Only Marketing managers can manage clients');
  return v;
}
function client(ctx, id, write = false, manage = false) {
  const v = marketing(ctx, write, manage);
  const c = ctx.db.get('SELECT c.*, p.name, p.client AS client_name, p.description, p.owner_id, p.status FROM marketing_clients c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.vertical_id = ?', toId(id, 'Client'), v.id);
  if (!c || !canView(ctx.user,{...c,id:c.project_id,vertical_id:v.id})) throw notFound('Client');
  if (write && ['completed', 'cancelled'].includes(c.status)) throw bad('Reopen this client before adding or changing work');
  return c;
}
function person(ctx, id, vid) {
  const value = optId(id);
  if (value && !atLeast(loadUser(ctx.db, value), vid, 'member')) throw bad('Choose an active Marketing team member');
  return value;
}
function notifySocial(ctx, userId, projectId, taskId, title, clientId) {
  if (!userId || userId === ctx.user.id) return;
  ctx.db.run('INSERT INTO notifications (user_id, project_id, task_id, text, link, created_at) VALUES (?,?,?,?,?,?)', userId, projectId, taskId, ctx.user.name + ' assigned you social/content ownership of “' + title + '”', '/marketing/' + clientId, ctx.now);
}
const required = (value, label, max = 160) => {
  const v = text(value, { required: true, label, max });
  if (!v) throw bad(label + ' is required');
  return v;
};
const requiredDate = (value, label) => { const v = optDate(value, label); if (!v) throw bad(label + ' is required'); return v; };
const workflow = row => TASK_STATE[row.workflow] === row.task_status ? row.workflow : ({ todo: 'Not Started', in_progress: 'In Process', review: 'In Review', blocked: 'Pending', done: 'Done' }[row.task_status] || row.workflow);
const JOB_QUERY = `SELECT j.*, t.title, t.description, t.status AS task_status, t.completed_at AS task_completed_at, t.priority, t.assignee_id, t.due_date,
  p.client AS client_name, p.id AS project_id, p.status AS client_status,p.vertical_id,p.owner_id,p.service_details,
  u.name AS designer_name, s.name AS social_name,
  (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id) AS asset_count
  FROM marketing_jobs j JOIN tasks t ON t.id = j.task_id JOIN marketing_clients c ON c.id = j.client_id
  JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users s ON s.id = j.social_owner_id`;
function jobs(ctx, v) {
  return ctx.db.all(JOB_QUERY + ' WHERE p.vertical_id = ? ORDER BY j.work_date DESC, t.id DESC', v.id).filter(j=>canReadWork(ctx.user,{...j,social_id:j.social_owner_id})).map(j => ({ ...j, workflow: workflow(j), finished_at: j.task_status === 'done' ? j.finished_at || j.task_completed_at : null }));
}
function clientFields(ctx, b, previous = {}) {
  const v = marketing(ctx);
  const target = b.monthly_target === undefined ? previous.monthly_target ?? 15 : Number(b.monthly_target);
  if (!Number.isInteger(target) || target < 1 || target > 1000) throw bad('Monthly target must be between 1 and 1000');
  const roles = {};
  for (const role of ['social_id','designer_id','manager_id','head_id']) roles[role] = b[role] === undefined ? previous[role] ?? null : person(ctx,b[role],v.id);
  for (const role of ['manager_id','head_id']) if (roles[role] && !atLeast(loadUser(ctx.db,roles[role]),v.id,'manager')) throw bad('Client manager and head need Marketing manager access');
  return { contact_name: text(b.contact_name, { max: 120 }) ?? '', contact_email: text(b.contact_email, { max: 200 }) ?? '', contact_phone: text(b.contact_phone, { max: 40 }) ?? '', platforms: text(b.platforms, { max: 300 }) ?? '', brand_notes: text(b.brand_notes, { max: 8000 }) ?? '', monthly_target: target, ...roles };
}

export function registerMarketing(route, call) {
  route('GET', '/marketing', ctx => {
    const v = marketing(ctx);
    const clients = ctx.db.all(`SELECT c.*, p.client AS name, p.description, p.owner_id, p.status, o.name AS owner_name,
      (SELECT COUNT(*) FROM marketing_jobs j JOIN tasks t ON t.id = j.task_id WHERE j.client_id = c.id AND t.status != 'done') AS open_jobs,
      (SELECT COUNT(*) FROM marketing_jobs j JOIN tasks t ON t.id = j.task_id WHERE j.client_id = c.id AND t.status != 'done' AND t.due_date < ?) AS overdue_jobs,
      (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS asset_count
      FROM marketing_clients c JOIN projects p ON p.id = c.project_id LEFT JOIN users o ON o.id = p.owner_id WHERE p.vertical_id = ? AND ${projectVisibilitySql(ctx.user)} ORDER BY p.client COLLATE NOCASE`, ctx.today, v.id);
    const reports = ctx.db.all(`SELECT r.*, u.name AS user_name, p.client AS client_name,p.id AS project_id,p.vertical_id,p.owner_id,p.service_details FROM marketing_reports r
      JOIN users u ON u.id = r.user_id JOIN marketing_clients c ON c.id = r.client_id JOIN projects p ON p.id = c.project_id
      WHERE p.vertical_id = ? ORDER BY r.report_date DESC, r.updated_at DESC`, v.id).filter(r=>canView(ctx.user,{...r,id:r.project_id})&&(r.user_id===ctx.user.id||canManageReport(ctx.user,r)));
    return { clients, jobs: jobs(ctx, v), reports, vertical: v, can_edit: atLeast(ctx.user, v.id, 'member'), can_manage: canManageVertical(ctx.user, v.id) };
  });
  route('GET', '/marketing/clients/:id', ctx => {
    const c = client(ctx, ctx.params.id);
    return { ...c, project: call(ctx, 'GET', '/projects/' + c.project_id) };
  });
  route('POST', '/marketing/clients', ctx => {
    const v = marketing(ctx, true, true), b = ctx.body;
    const name = required(b.name, 'Client name');
    if (ctx.db.get('SELECT 1 AS n FROM marketing_clients c JOIN projects p ON p.id = c.project_id WHERE p.vertical_id = ? AND lower(p.client) = lower(?)', v.id, name)) throw bad('This client already exists');
    const owner = person(ctx, b.owner_id, v.id) || ctx.user.id;
    const members = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(id => person(ctx, id, v.id)).filter(Boolean))] : [];
    const f = clientFields(ctx, b);
    return ctx.db.tx(() => {
      const p = call(ctx, 'POST', '/projects', { vertical_id: v.id, name: name + ' · Content & social media', client: name, description: text(b.description, { max: 10000 }) || '', owner_id: f.manager_id || owner, member_ids: [...new Set([...members, f.social_id, f.designer_id, f.manager_id, f.head_id].filter(Boolean))], status: 'active', stages: ['Brief', 'Content', 'Design', 'Review', 'Publish'] });
      const { id } = ctx.db.run('INSERT INTO marketing_clients (project_id, contact_name, contact_email, contact_phone, platforms, brand_notes, monthly_target, social_id, designer_id, manager_id, head_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', p.id, ...Object.values(f));
      return client(ctx, id);
    });
  });
  route('PATCH', '/marketing/clients/:id', ctx => {
    // Archived clients may be edited/reopened by a manager.
    marketing(ctx, true, true);
    const c = client(ctx, ctx.params.id), b = ctx.body;
    const name = required(b.name, 'Client name');
    if (ctx.db.get('SELECT 1 AS n FROM marketing_clients c JOIN projects p ON p.id = c.project_id WHERE c.id != ? AND p.vertical_id = ? AND lower(p.client) = lower(?)', c.id, marketing(ctx).id, name)) throw bad('This client already exists');
    const f = clientFields(ctx, b, c);
    const owner = person(ctx, b.owner_id, marketing(ctx).id) || c.owner_id;
    const status = oneOf(b.status, ['active', 'on_hold', 'completed'], 'Client status') || c.status;
    const members = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(id => person(ctx, id, marketing(ctx).id)).filter(Boolean))] : null;
    return ctx.db.tx(() => {
      call(ctx, 'PATCH', '/projects/' + c.project_id, { client: name, name: name + ' · Content & social media', description: text(b.description, { max: 10000 }) || '', owner_id: f.manager_id || owner, status });
      ctx.db.run('UPDATE marketing_clients SET contact_name = ?, contact_email = ?, contact_phone = ?, platforms = ?, brand_notes = ?, monthly_target = ?, social_id = ?, designer_id = ?, manager_id = ?, head_id = ? WHERE id = ?', ...Object.values(f), c.id);
      call(ctx, 'PUT', '/projects/' + c.project_id + '/members', { user_ids: [...new Set([f.manager_id || owner, ...(members || []), f.social_id, f.designer_id, f.manager_id, f.head_id].filter(Boolean))] });
      return client(ctx, c.id);
    });
  });
  route('POST', '/marketing/jobs', ctx => {
    const v = marketing(ctx, true), b = ctx.body, c = client(ctx, b.client_id, true);
    const title = required(b.title, 'Content brief', 240);
    const post = oneOf(b.post_type, POST_TYPES, 'Post type') || 'Still';
    const platform = oneOf(b.platform, PLATFORMS, 'Platform') || 'Instagram';
    const workDate = requiredDate(b.work_date, 'Work date');
    const due = requiredDate(b.due_date, 'Deadline');
    const publish = optDate(b.publish_date, 'Publish date') || null;
    if (due < workDate) throw bad('Deadline cannot be before the work date');
    const social = person(ctx, b.social_owner_id, v.id) || null;
    const designer = person(ctx, b.assignee_id, v.id) || null;
    return ctx.db.tx(() => {
      const t = call(ctx, 'POST', '/projects/' + c.project_id + '/tasks', { title, description: text(b.description, { max: 10000 }) || '', assignee_id: designer, start_date: workDate, due_date: due, priority: oneOf(b.priority, ['low', 'medium', 'high', 'urgent'], 'Priority') || 'medium', stage: 'Content' });
      ctx.db.run('INSERT INTO marketing_jobs (task_id, client_id, post_type, platform, social_owner_id, work_date, publish_date) VALUES (?,?,?,?,?,?,?)', t.id, c.id, post, platform, social, workDate, publish);
      if (social) ctx.db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', c.project_id, social);
      notifySocial(ctx, social, c.project_id, t.id, title, c.id);
      return jobs(ctx, v).find(j => j.task_id === t.id);
    });
  });
  route('PATCH', '/marketing/jobs/:id', ctx => {
    const v = marketing(ctx, true), b = ctx.body;
    const j = jobs(ctx, v).find(j => j.task_id === toId(ctx.params.id, 'Content job'));
    if (!j) throw notFound('Content job');
    const c = client(ctx, j.client_id, true);
    const state = oneOf(b.workflow, JOB_STATUSES, 'Status') || j.workflow;
    const post = oneOf(b.post_type, POST_TYPES, 'Post type') || j.post_type;
    const platform = oneOf(b.platform, PLATFORMS, 'Platform') || j.platform;
    const social = b.social_owner_id === undefined ? j.social_owner_id : person(ctx, b.social_owner_id, v.id);
    const designer = b.assignee_id === undefined ? j.assignee_id : person(ctx, b.assignee_id, v.id);
    const workDate = b.work_date === undefined ? j.work_date : requiredDate(b.work_date, 'Work date');
    const due = b.due_date === undefined ? j.due_date : requiredDate(b.due_date, 'Deadline');
    const publish = b.publish_date === undefined ? j.publish_date : optDate(b.publish_date, 'Publish date');
    if (due < workDate) throw bad('Deadline cannot be before the work date');
    const started = j.started_at || (!['Not Started', 'Pending', 'Stop'].includes(state) ? ctx.now : null);
    const finished = CLOSED_JOBS.includes(state) ? j.finished_at || ctx.now : null;
    return ctx.db.tx(() => {
      call(ctx, 'PATCH', '/tasks/' + j.task_id, { title: b.title === undefined ? j.title : required(b.title, 'Content brief', 240), description: b.description === undefined ? j.description : text(b.description, { max: 10000 }), assignee_id: designer, status: TASK_STATE[state], start_date: workDate, due_date: due, priority: b.priority });
      ctx.db.run('UPDATE marketing_jobs SET post_type = ?, platform = ?, social_owner_id = ?, work_date = ?, publish_date = ?, workflow = ?, started_at = ?, finished_at = ? WHERE task_id = ?', post, platform, social, workDate, publish, state, started, finished, j.task_id);
      if (social) ctx.db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', c.project_id, social);
      if (social !== j.social_owner_id) notifySocial(ctx, social, c.project_id, j.task_id, b.title || j.title, c.id);
      if (state !== j.workflow || post !== j.post_type || platform !== j.platform || social !== j.social_owner_id || workDate !== j.work_date || publish !== j.publish_date) {
        ctx.db.run('INSERT INTO activity (project_id, task_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)', c.project_id, j.task_id, ctx.user.id, 'updated', 'Content job: ' + state + ' · ' + post + ' · ' + platform, ctx.now);
      }
      return jobs(ctx, v).find(row => row.task_id === j.task_id);
    });
  });
  route('POST', '/marketing/reports', ctx => {
    marketing(ctx, true);
    const b = ctx.body, c = client(ctx, b.client_id, true);
    const day = requiredDate(b.report_date, 'Report date');
    if (day > ctx.today) throw bad('Daily reports cannot be dated in the future');
    const accomplished = required(b.accomplished, 'Daily update', 8000);
    const blockers = text(b.blockers, { max: 4000 }) || '', plan = text(b.next_plan, { max: 4000 }) || '';
    ctx.db.run('INSERT INTO marketing_reports (client_id, user_id, report_date, accomplished, blockers, next_plan, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(client_id, user_id, report_date) DO UPDATE SET accomplished = excluded.accomplished, blockers = excluded.blockers, next_plan = excluded.next_plan, updated_at = excluded.updated_at', c.id, ctx.user.id, day, accomplished, blockers, plan, ctx.now);
    return { ok: true };
  });
}
