import { bad, parseJSON, placeholders } from './util.js';

export function reportingMonth(value, today) {
  const month = value === undefined || value === '' ? today.slice(0, 7) : String(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('Choose a valid reporting month');
  return month;
}

// Work belongs to its planned month. Revisions retain the same task id.
export function socialProgressFor(db, projects, today, requestedMonth) {
  const social = projects.filter((p) => p.service_type === 'social');
  const result = new Map();
  if (!social.length) return result;
  const month = reportingMonth(requestedMonth, today);
  for (const p of social) {
    const details =
      typeof p.service_details === 'string' ? parseJSON(p.service_details, {}) : p.service_details;
    const target = Math.max(0, Number(details?.monthly_target) || 0);
    result.set(p.id, {
      month,
      as_of: today,
      target,
      assigned: 0,
      done: 0,
      running: 0,
      paused: 0,
      not_started: 0,
      changes_requested: 0,
      overdue: 0,
      remaining: target,
      unassigned: target,
      percent: 0,
    });
  }
  const rows = db.all(
    `SELECT
      t.project_id,
      t.status,
      COALESCE(d.report_date, t.due_date, t.start_date, substr(t.created_at, 1, 10)) AS work_date,
      w.state,
      w.revision_pending
    FROM tasks t
    LEFT JOIN daily_reporting d ON d.task_id = t.id
    LEFT JOIN report_work w ON w.task_id = t.id
    WHERE t.project_id IN (` +
      placeholders(social) +
      ') AND substr(COALESCE(d.report_date,t.due_date,t.start_date,t.created_at),1,7)=?',
    ...social.map((p) => p.id),
    month,
  );
  for (const r of rows) {
    const s = result.get(r.project_id);
    const done = r.status === 'done' && (!r.state || r.state === 'Done') && !r.revision_pending;
    s.assigned++;
    if (done) s.done++;
    else if (r.revision_pending) s.changes_requested++;
    else if (r.state === 'In Process' || (!r.state && r.status === 'in_progress')) s.running++;
    else if (r.state === 'Paused' || (!r.state && ['blocked', 'review'].includes(r.status)))
      s.paused++;
    else s.not_started++;
    if (!done && r.work_date < today) s.overdue++;
  }
  for (const s of result.values()) {
    s.remaining = Math.max(0, s.target - s.done);
    s.unassigned = Math.max(0, s.target - s.assigned);
    s.percent = s.target ? Math.min(100, Math.round((s.done / s.target) * 100)) : 0;
  }
  return result;
}
