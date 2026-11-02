import { bad, forbidden, parseJSON, placeholders } from './util.js';
import { isDevelopmentProject, canChooseWorkContact, websiteDevelopers, WEBSITE_STAGES } from './project-services.js';

export function assertWebsiteAssignment(ctx, project, assignee) {
  if (!isDevelopmentProject(project)) return;
  const developers=websiteDevelopers(project);
  if (!assignee || !developers.includes(Number(assignee))) throw bad('Choose a developer from this development project team');
  if (!canChooseWorkContact(ctx.user,project)) throw forbidden('Only the development head or manager can create and assign main tasks. Add daily modules in Development Reporting.');
}
export function websitePhase(value, fallback='Development') {
  if (WEBSITE_STAGES.includes(value)) return value;
  return ({Plan:'Design',Execute:'Development',Deliver:'Testing',Close:'Launch',Content:'Development',Maintenance:'Development'})[value] || fallback;
}
export function websiteProgressFor(db, projects, today) {
  const websites=projects.filter(p=>isDevelopmentProject(p)),out=new Map();
  if (!websites.length) return out;
  for (const p of websites) out.set(p.id,{total:0,done:0,running:0,paused:0,ready_for_review:0,changes_requested:0,overdue:0,percent:0,current_phase:'Design',ready:false,phases:WEBSITE_STAGES.map(name=>({name,total:0,done:0,percent:0})),developers:websiteDevelopers(p).map(id=>({id,total:0,done:0,running:0}))});
  for (const t of db.all("SELECT t.project_id,t.assignee_id,t.stage,t.status,t.due_date,w.state,(COALESCE(w.revision_pending,0) OR EXISTS (SELECT 1 FROM extra_work ce JOIN report_work cw ON cw.extra_id=ce.id WHERE ce.parent_task_id=t.id AND cw.revision_pending=1) OR (SELECT r.status FROM website_task_reviews r WHERE r.task_id=t.id ORDER BY r.id DESC LIMIT 1)='changes_required') revision_pending,(SELECT COUNT(*) FROM report_work_sessions rs JOIN report_work rw ON rw.work_key=rs.work_key LEFT JOIN extra_work re ON re.id=rw.extra_id WHERE rs.ended_at IS NULL AND (rw.task_id=t.id OR re.parent_task_id=t.id)) active_modules FROM tasks t LEFT JOIN report_work w ON w.task_id=t.id WHERE t.project_id IN ("+placeholders(websites)+")",...websites.map(p=>p.id))) {
    const s=out.get(t.project_id),phase=s.phases.find(p=>p.name===websitePhase(t.stage));
    const done=t.status==='done'&&!t.revision_pending;
    const running=t.active_modules>0;
    s.total++;phase.total++;
    if(done){s.done++;phase.done++;}
    else if(t.status==='review')s.ready_for_review++;
    else if(t.revision_pending)s.changes_requested++;
    else if(running)s.running++;
    else if(['in_progress','blocked'].includes(t.status))s.paused++;
    if(!done&&t.due_date&&t.due_date<today)s.overdue++;
    const developer=s.developers.find(d=>d.id===t.assignee_id);
    if(developer){developer.total++;if(done)developer.done++;if(running&&!done)developer.running++;}
  }
  for (const s of out.values()) {
    s.percent=s.total?Math.round(s.done/s.total*100):0;
    s.ready=s.total>0&&s.done===s.total;
    s.current_phase=s.phases.find(p=>p.total>p.done)?.name||(s.ready?'Launch':'Design');
    for(const phase of s.phases)phase.percent=phase.total?Math.round(phase.done/phase.total*100):0;
  }
  return out;
}

export function websiteTaskTime(db,taskId,now) {
  const sessions=db.all('SELECT s.* FROM report_work_sessions s JOIN report_work w ON w.work_key=s.work_key LEFT JOIN extra_work e ON e.id=w.extra_id WHERE w.task_id=? OR e.parent_task_id=?',taskId,taskId);
  const total_ms=sessions.reduce((n,s)=>n+s.duration_ms,0);
  const elapsed_ms=total_ms+sessions.filter(s=>!s.ended_at).reduce((n,s)=>n+Math.max(0,Date.parse(now)-Date.parse(s.started_at)),0);
  const daily_entries=db.get('SELECT COUNT(*) n FROM extra_work WHERE parent_task_id=?',taskId).n;
  return {total_ms,elapsed_ms,daily_entries,running:sessions.some(s=>!s.ended_at)};
}
