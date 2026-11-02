import { websitePhase } from './website-work.js';
import { isDevelopmentProject, projectDetails, websiteDevelopers, normalizeWebsiteFields, projectRoleIds, WEBSITE_STAGES } from './project-services.js';
import { bad, forbidden, notFound, toId, parseJSON, todayIn } from './util.js';

export const TRACKING_SCHEMA = `
CREATE TABLE IF NOT EXISTS website_task_reviews (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','changes_required')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  feedback TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_website_review_task ON website_task_reviews(task_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_website_review_pending ON website_task_reviews(task_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS extra_work (
  id INTEGER PRIMARY KEY,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id),
  title TEXT NOT NULL,
  client_label TEXT NOT NULL DEFAULT '',
  work_type TEXT NOT NULL DEFAULT 'Graphic',
  reporting_team TEXT NOT NULL DEFAULT 'social' CHECK (reporting_team IN ('social','development','other')),
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  continued_from_key TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL,
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_work (
  work_key TEXT PRIMARY KEY,
  task_id INTEGER UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  extra_id INTEGER UNIQUE REFERENCES extra_work(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'Not Started',
  first_started_at TEXT,
  completed_at TEXT,
  revision_no INTEGER NOT NULL DEFAULT 0,
  revision_pending INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  CHECK ((task_id IS NOT NULL AND extra_id IS NULL) OR (task_id IS NULL AND extra_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS report_work_sessions (
  id INTEGER PRIMARY KEY,
  work_key TEXT NOT NULL REFERENCES report_work(work_key) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  revision_no INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_one_running_user ON report_work_sessions(user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_one_running_work ON report_work_sessions(work_key) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS report_work_notes (
  id INTEGER PRIMARY KEY,
  work_key TEXT NOT NULL REFERENCES report_work(work_key) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'note',
  revision_no INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function initExistingWork(db,now=new Date().toISOString()) {
  for(const r of db.all('SELECT d.task_id,t.status,d.updated_at,d.created_by,d.start_time,d.completion_time,d.delay_reason FROM daily_reporting d JOIN tasks t ON t.id=d.task_id')) {
    const state=r.status==='done'?'Done':r.status==='in_progress'||r.status==='review'||r.status==='blocked'?'Paused':'Not Started';
    const added=db.run('INSERT OR IGNORE INTO report_work (work_key,task_id,state,updated_at) VALUES (?,?,?,?)','task-'+r.task_id,r.task_id,state,r.updated_at || now);
    if(added.changes && (r.delay_reason || r.start_time || r.completion_time)){
      const note=[r.delay_reason?'Earlier delay note: '+r.delay_reason:'',(r.start_time||r.completion_time)?'Earlier manual times: '+(r.start_time||'—')+' → '+(r.completion_time||'—')+'. Automatic active time starts from the next Start/Resume.':''].filter(Boolean).join('\n');
      db.run("INSERT INTO report_work_notes (work_key,user_id,kind,note,created_at) VALUES (?,?,'note',?,?)",'task-'+r.task_id,r.created_by,note,r.updated_at || now);
    }
  }
}
export function trackingTaskGuard(ctx,task) {
  if(ctx.timerTransition)return;
  if(!ctx.db.get('SELECT work_key FROM report_work WHERE task_id=?',task.id))return;
  const website=isDevelopmentProject(ctx.db.get('SELECT service_type FROM projects WHERE id=?',task.project_id));
  if(website)return; // Development main tasks are managed by the head; daily modules have their own timers.
  const fields=['status','assignee_id'];
  if(fields.some(k=>ctx.body[k]!==undefined))throw bad('Task status, timing and assignment are managed in Daily Reporting');
}
export function workId(raw) {
  const s=String(raw);
  const extra=/^extra-(\d+)$/.exec(s);
  return extra?{key:'extra-'+toId(extra[1]),extraId:Number(extra[1])}:{key:'task-'+toId(s.replace(/^task-/,'')),taskId:toId(s.replace(/^task-/,''))};
}
export function workTotals(db,key,at) {
  const sessions=db.all('SELECT * FROM report_work_sessions WHERE work_key=? ORDER BY id',key);
  const running=sessions.find(s=>!s.ended_at);
  const total=sessions.reduce((n,s)=>n+s.duration_ms,0);
  return {sessions,running,total_ms:total,elapsed_ms:total+(running?Math.max(0,new Date(at)-new Date(running.started_at)):0)};
}
export function addWorkNote(ctx,key,note,kind='note',revision=0) {
  ctx.db.run('INSERT INTO report_work_notes (work_key,user_id,kind,revision_no,note,created_at) VALUES (?,?,?,?,?,?)',key,ctx.user.id,kind,revision,note,ctx.now);
}
export function startInterval(ctx,key,revision) {
  const other=ctx.db.get('SELECT work_key FROM report_work_sessions WHERE user_id=? AND ended_at IS NULL',ctx.user.id);
  if(other && other.work_key!==key)throw bad('Pause your current running work before starting another');
  if(!other)ctx.db.run('INSERT INTO report_work_sessions (work_key,user_id,revision_no,started_at) VALUES (?,?,?,?)',key,ctx.user.id,revision,ctx.now);
}
export function stopInterval(ctx,key) {
  const current=ctx.db.get('SELECT * FROM report_work_sessions WHERE work_key=? AND ended_at IS NULL',key);
  if(!current)return;
  if(current.user_id!==ctx.user.id)throw forbidden('Only the running designer can stop this timer');
  const ms=Number(new Date(ctx.now))-Number(new Date(current.started_at));
  if(ms<0)throw bad('Server time is before the timer start; try again');
  ctx.db.run('UPDATE report_work_sessions SET ended_at=?,duration_ms=? WHERE id=?',ctx.now,ms,current.id);
}

export function initSocialDailyRows(db, now = new Date().toISOString(), projectId) {
  const rows=db.all("SELECT t.*,p.service_details,p.owner_id FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN daily_reporting d ON d.task_id=t.id WHERE p.service_type='social' AND d.task_id IS NULL"+(projectId?' AND p.id=?':''),...(projectId?[projectId]:[]));
  for (const t of rows) {
    const details=parseJSON(t.service_details,{});
    const creator=[t.created_by,t.owner_id,details.lead_id].find(id=>id&&db.get('SELECT id FROM users WHERE id=?',id));
    if (!creator) continue;
    const social=details.lead_id&&db.get('SELECT id FROM users WHERE id=?',details.lead_id)?details.lead_id:creator;
    const date=t.due_date||t.start_date||t.created_at?.slice(0,10)||todayIn('Asia/Kolkata',new Date(now));
    const state=t.status==='done'?'Done':t.status==='todo'?'Not Started':'Paused';
    db.run('INSERT INTO daily_reporting (task_id,report_date,work_type,social_id,status,remarks,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?)',t.id,date,'Still',social,state,t.description||'',creator,t.updated_at||now);
    db.run('INSERT OR IGNORE INTO report_work (work_key,task_id,state,completed_at,updated_at) VALUES (?,?,?,?,?)','task-'+t.id,t.id,state,t.status==='done'?t.completed_at:null,t.updated_at||now);
  }
}

export function initWebsiteDailyRows(db, now = new Date().toISOString(), projectId) {
  const rows=db.all("SELECT t.*,p.owner_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.service_type IN ('website','software')"+(projectId?' AND p.id=?':''),...(projectId?[projectId]:[]));
  for(const t of rows) {
    const phase=websitePhase(t.stage,'Design');
    if(phase!==t.stage)db.run('UPDATE tasks SET stage=? WHERE id=?',phase,t.id);
    if(db.get('SELECT task_id FROM daily_reporting WHERE task_id=?',t.id)){
      db.run('UPDATE daily_reporting SET social_id=NULL WHERE task_id=?',t.id);
      continue;
    }
    const creator=[t.created_by,t.owner_id].find(id=>id&&db.get('SELECT id FROM users WHERE id=?',id));
    if(!creator)continue;
    const date=t.start_date||t.created_at?.slice(0,10)||t.due_date||todayIn('Asia/Kolkata',new Date(now));
    const state=t.status==='done'?'Done':t.status==='todo'?'Not Started':'Paused';
    db.run('INSERT INTO daily_reporting (task_id,report_date,work_type,social_id,status,remarks,created_by,updated_at) VALUES (?,?,?,NULL,?,?,?,?)',t.id,date,phase,state,t.description||'',creator,t.updated_at||now);
    db.run('INSERT OR IGNORE INTO report_work (work_key,task_id,state,completed_at,updated_at) VALUES (?,?,?,?,?)','task-'+t.id,t.id,state,t.status==='done'?t.completed_at:null,t.updated_at||now);
  }
}
export function upgradeWebsiteProjects(db, now = new Date().toISOString()) {
  for(const p of db.all("SELECT * FROM projects WHERE service_type='website'")) {
    const d=projectDetails(p);
    const developers=[...new Set([...websiteDevelopers(p),...db.all('SELECT DISTINCT assignee_id AS id FROM tasks WHERE project_id=? AND assignee_id IS NOT NULL',p.id).map(r=>r.id)])];
    const fields={service_type:'website',service_details:JSON.stringify({...d,developer_ids:developers})};
    normalizeWebsiteFields(fields,p,p.owner_id);
    db.run('UPDATE projects SET service_details=?,owner_id=?,stages=?,stage=? WHERE id=?',fields.service_details,fields.owner_id,JSON.stringify(WEBSITE_STAGES),WEBSITE_STAGES[0],p.id);
    db.run('DELETE FROM project_members WHERE project_id=?',p.id);
    for(const id of projectRoleIds(JSON.parse(fields.service_details)))db.run('INSERT INTO project_members (project_id,user_id) VALUES (?,?)',p.id,id);
    initWebsiteDailyRows(db,now,p.id);
  }
}
