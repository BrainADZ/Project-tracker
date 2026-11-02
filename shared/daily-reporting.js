import { REPORTING_DEPARTMENTS, defaultReportingDepartment, projectReportingDepartment, rowReportingDepartment, reportingAccess, canReadWork, canManageReport, reportingPath } from './reporting-access.js';
import { assertWebsiteAssignment } from './website-work.js';
import { bad, forbidden, notFound, toId, text, optId, optDate, oneOf, isDate, placeholders, addDays, parseJSON } from './util.js';
import { loadUser, atLeast, visibleVerticalIds, canView } from './access.js';
import { initExistingWork, workId, workTotals, addWorkNote, startInterval, stopInterval } from './work-tracking.js';
import { isDevelopmentProject, canChooseWorkContact, websiteDevelopers, WEBSITE_STAGES } from './project-services.js';
export const DAILY_STATUSES=['Not Started','In Process','Paused','Done'];
export const WORK_TYPES={social:['Video','Still','Carousel','Animation','Editing','Graphic'],website:['Design','Development','Content','Testing','Maintenance'],software:['Design','Development','Testing','Launch'],seo:['On-page SEO','Off-page SEO','Technical SEO','Content','Reporting'],ads:['Creative','Campaign setup','Optimisation','Tracking','Reporting'],other:['Graphic','Video','Editing','Presentation','Print','Website','Other']};
export function importLegacyDailyRows(db) {
  for(const c of db.all('SELECT * FROM marketing_clients')) db.run("UPDATE projects SET service_type='social',service_details=? WHERE id=? AND service_type=''",JSON.stringify({monthly_target:c.monthly_target || 15,platforms:c.platforms || '',lead_id:c.social_id,specialist_id:c.designer_id,manager_id:c.manager_id,head_id:c.head_id}),c.project_id);
  db.exec(`INSERT OR IGNORE INTO daily_reporting (task_id,report_date,work_type,social_id,start_time,completion_time,status,delay_reason,remarks,created_by,updated_at)
    SELECT j.task_id,j.work_date,j.post_type,j.social_owner_id,
    COALESCE(strftime('%H:%M',j.started_at,'+5 hours','+30 minutes'),''),COALESCE(strftime('%H:%M',j.finished_at,'+5 hours','+30 minutes'),''),
    CASE t.status WHEN 'done' THEN 'Done' WHEN 'in_progress' THEN 'In Process' WHEN 'review' THEN 'In Review' WHEN 'blocked' THEN 'Pending' ELSE 'Not Started' END,
    j.delay_reason,COALESCE(t.description,''),COALESCE(t.created_by,p.owner_id),COALESCE(t.updated_at,t.created_at)
    FROM marketing_jobs j JOIN tasks t ON t.id = j.task_id JOIN projects p ON p.id = t.project_id;`);
}
function getProject(ctx,id,write=false) {
  const p=ctx.db.get('SELECT * FROM projects WHERE id=?',toId(id,'Project'));
  if(!canView(ctx.user,p))throw notFound('Project');
  if(write && !atLeast(ctx.user,p.vertical_id,'member'))throw forbidden('You have view-only access');
  if(write && ['completed','cancelled'].includes(p.status))throw bad('Reopen the project before changing its work');
  return p;
}
function person(ctx,value,vid){const id=optId(value);if(id && !atLeast(loadUser(ctx.db,id),vid,'member'))throw bad('Choose an active member of this vertical');return id;}
function socialContact(ctx,project,body,existing) {
  if(isDevelopmentProject(project)){if(body.social_id)throw bad('Development projects use a head and developers, not a social contact');return null;}
  if (canChooseWorkContact(ctx.user,project)) return body.social_id === undefined ? (existing === undefined ? null : existing) : person(ctx,body.social_id,project.vertical_id);
  // Keep the configured project contact for new work, and preserve historical assignments on edit.
  const fixed = existing === undefined ? person(ctx,parseJSON(project.service_details,{}).lead_id || ctx.user.id,project.vertical_id) : existing;
  if (body.social_id !== undefined && optId(body.social_id) !== fixed) throw forbidden('Only the manager or head can choose the social / content person');
  return fixed;
}
const required=(value,label,max=240)=>{const s=text(value,{max,label,required:true});if(!s)throw bad(label+' is required');return s;};
function rejectManualTiming(b){if(['status','start_time','completion_time','total_ms','elapsed_ms','state'].some(k=>b[k]!==undefined))throw bad('Status and time are automatic. The assigned person uses Start, Pause, Resume and Done.');}
const ROWS=`SELECT d.task_id AS id,d.task_id,d.report_date,d.work_type,d.social_id,d.remarks,d.delay_reason,d.created_by,d.updated_at,
  t.project_id,t.title,t.assignee_id,t.status AS parent_status,t.due_date,t.stage,p.name AS project_name,p.client,p.service_type,p.service_details,p.owner_id,p.status AS project_status,p.vertical_id,
  u.name AS designer_name,s.name AS social_name,w.work_key,w.state AS status,w.first_started_at,w.completed_at,w.revision_no,w.revision_pending,w.updated_at AS timer_updated_at
  FROM daily_reporting d JOIN tasks t ON t.id=d.task_id JOIN projects p ON p.id=t.project_id JOIN report_work w ON w.task_id=d.task_id
  LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN users s ON s.id=d.social_id`;
const EXTRA_ROWS=`SELECT 'extra-'||e.id AS id,NULL AS task_id,e.parent_task_id,e.continued_from_key,e.report_date,e.work_type,e.reporting_team,NULL AS social_id,e.remarks,'' AS delay_reason,e.created_by,e.updated_at,
  p.id AS project_id,e.title,e.assignee_id,t.title AS parent_task_title,t.status AS parent_status,t.assignee_id AS parent_assignee_id,t.due_date,COALESCE(t.stage,'') AS stage,COALESCE(p.name,'Extra work') AS project_name,COALESCE(p.client,e.client_label) AS client,COALESCE(p.service_type,'other') AS service_type,p.service_details,p.owner_id,COALESCE(p.status,'active') AS project_status,e.vertical_id,
  u.name AS designer_name,NULL AS social_name,w.work_key,w.state AS status,w.first_started_at,w.completed_at,w.revision_no,w.revision_pending,w.updated_at AS timer_updated_at
  FROM extra_work e JOIN report_work w ON w.extra_id=e.id JOIN users u ON u.id=e.assignee_id LEFT JOIN tasks t ON t.id=e.parent_task_id LEFT JOIN projects p ON p.id=t.project_id`;
function entry(ctx,id,write=false){
  const parsed=workId(id);
  const r=parsed.extraId?ctx.db.get(EXTRA_ROWS+' WHERE e.id=?',parsed.extraId):ctx.db.get(ROWS+' WHERE d.task_id=?',parsed.taskId);
  if(!canReadWork(ctx.user,r)||(ctx.query.department&&ctx.query.department!==rowReportingDepartment(r)))throw notFound('Work');
  if(write && !atLeast(ctx.user,r.vertical_id,'member'))throw forbidden('You have view-only access');
  if(write && ['completed','cancelled'].includes(r.project_status))throw bad('Reopen this project before changing its work');
  return r;
}
function permissions(ctx,r){
  const member=atLeast(ctx.user,r.vertical_id,'member')&&!['completed','cancelled'].includes(r.project_status);
  const manager=canManageReport(ctx.user,r);
  if(isDevelopmentProject(r)){
    const developer=websiteDevelopers(r).includes(ctx.user.id),own=developer&&r.assignee_id===ctx.user.id;
    return {can_edit:member&&!!r.parent_task_id&&own&&!['review','done'].includes(r.parent_status),can_timer:member&&own&&r.parent_status!=='review'&&(!r.parent_task_id||r.parent_status!=='done'&&(r.parent_assignee_id===ctx.user.id||r.status==='In Process'))&&(!!r.parent_task_id||!!ctx.db.get('SELECT id FROM report_work_sessions WHERE work_key=? AND ended_at IS NULL',r.work_key)),can_note:member&&(manager||own),can_request_revision:member&&manager&&!!r.parent_task_id&&r.parent_status!=='review',can_continue:member&&own&&r.parent_status!=='review'&&r.report_date<ctx.today&&(['Under process','Paused','Not Started'].includes(r.status)||r.status==='Done'&&r.revision_pending)&&(!r.parent_task_id||r.parent_status!=='done'&&r.parent_assignee_id===ctx.user.id)};
  }
  return {can_continue:member&&r.reporting_team==='development'&&r.assignee_id===ctx.user.id&&r.report_date<ctx.today&&(['Under process','Paused','Not Started'].includes(r.status)||r.status==='Done'&&r.revision_pending),can_edit:member&&([r.created_by,r.social_id,r.owner_id].includes(ctx.user.id)||manager),can_timer:member&&r.assignee_id===ctx.user.id,can_note:member&&([r.created_by,r.social_id,r.assignee_id,r.owner_id].includes(ctx.user.id)||manager),can_request_revision:member&&([r.created_by,r.social_id,r.owner_id].includes(ctx.user.id)||manager)};
}
function boundary(day,timeZone){
  const target=new Date(day+'T00:00:00Z').getTime();let guess=target;
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let n=0;n<3;n++){const parts=Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p=>[p.type,p.value]));const asUTC=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));guess+=target-asUTC;}
  return guess;
}
function shape(ctx,r,range){
  const totals=workTotals(ctx.db,r.work_key,ctx.now);
  const period=range?totals.sessions.reduce((sum,s)=>sum+Math.max(0,Math.min(new Date(s.ended_at||ctx.now).getTime(),range.end)-Math.max(new Date(s.started_at).getTime(),range.start)),0):totals.elapsed_ms;
  return {...r,...permissions(ctx,r),total_ms:totals.total_ms,elapsed_ms:totals.elapsed_ms,period_ms:period,running_since:totals.running?.started_at || null,current_revision_ms:totals.sessions.filter(s=>s.revision_no===r.revision_no).reduce((n,s)=>n+s.duration_ms,0),last_note:ctx.db.get("SELECT note FROM report_work_notes WHERE work_key=? AND kind!='event' ORDER BY id DESC LIMIT 1",r.work_key)?.note || '',note_count:ctx.db.get("SELECT COUNT(*) AS n FROM report_work_notes WHERE work_key=? AND kind!='event'",r.work_key).n};
}
function syncTask(ctx,call,r,state){
  if(r.parent_task_id){
    if(['In Process','Done','Under process'].includes(state))call({...ctx,timerTransition:true},'PATCH','/tasks/'+r.parent_task_id,{status:'in_progress'});
    ctx.db.run('UPDATE extra_work SET updated_at=? WHERE id=?',ctx.now,workId(r.id).extraId);
  }else if(r.task_id){
    call({...ctx,timerTransition:true},'PATCH','/tasks/'+r.task_id,{status:state==='Done'?'done':state==='Not Started'?'todo':'in_progress'});
    ctx.db.run('UPDATE daily_reporting SET status=?,updated_at=? WHERE task_id=?',state,ctx.now,r.task_id);
  }else ctx.db.run('UPDATE extra_work SET updated_at=? WHERE id=?',ctx.now,workId(r.id).extraId);
}
function notify(ctx,r,userId,message){
  if(!userId||userId===ctx.user.id)return;
  ctx.db.run('INSERT INTO notifications (user_id,project_id,task_id,text,link,created_at) VALUES (?,?,?,?,?,?)',userId,r.project_id,r.task_id,message,r.project_id?'/daily-reporting/'+r.project_id:reportingPath(rowReportingDepartment(r)),ctx.now);
}
export function registerDailyReporting(route,call){
  route('GET','/daily-reporting',ctx=>{
    const day=ctx.query.date||ctx.today;if(!isDate(day))throw bad('Choose a valid date');
    const vids=visibleVerticalIds(ctx.user);if(!vids.length)throw forbidden('Project access is required');
    const mode=ctx.query.scope==='project'?'project':ctx.query.scope==='month'?'month':'day',from=mode==='month'?day.slice(0,7)+'-01':day;
    const next=mode==='month'?new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),1)).toISOString().slice(0,10):addDays(day,1);
    const zone=ctx.services.timeZone||'Asia/Kolkata',range={start:boundary(from,zone),end:boundary(next,zone)};
    let all=[...ctx.db.all(ROWS+' WHERE p.vertical_id IN ('+placeholders(vids)+')',...vids),...ctx.db.all(EXTRA_ROWS+' WHERE e.vertical_id IN ('+placeholders(vids)+')',...vids)];
    const project=ctx.query.project?getProject(ctx,ctx.query.project):null;
    if(mode==='project'&&!project)throw bad('Choose a project to view all tasks');
    const department=ctx.query.department?oneOf(ctx.query.department,Object.keys(REPORTING_DEPARTMENTS),'Reporting department'):project?projectReportingDepartment(project):reportingAccess(ctx.db,ctx.user).default_department;
    if(project&&department!==projectReportingDepartment(project))throw bad('This project belongs to a different reporting sheet');
    all=all.filter(r=>(!project||r.project_id===project.id)&&rowReportingDepartment(r)===department&&canReadWork(ctx.user,r)&&(department!=='development'||!r.task_id||!!ctx.db.get('SELECT id FROM report_work_sessions WHERE work_key=? LIMIT 1',r.work_key)));
    const managedProjects=ctx.db.all('SELECT * FROM projects WHERE vertical_id IN ('+placeholders(vids)+')',...vids).filter(p=>projectReportingDepartment(p)===department&&(!project||p.id===project.id)&&canManageReport(ctx.user,p));
    const can_view_team=project?canManageReport(ctx.user,project):vids.some(id=>ctx.user.role==='admin'||ctx.user.access.get(id)==='manager')||managedProjects.length>0;
    const member_ids=[...new Set(all.flatMap(r=>[r.social_id,r.assignee_id]).filter(Boolean))];
    const items=all.map(r=>shape(ctx,r,mode==='project'?null:range)).filter(r=>{
      if(mode==='project')return true;
      const ownDate=r.report_date>=from&&r.report_date<next;
      const notes=ctx.db.get('SELECT id FROM report_work_notes WHERE work_key=? AND created_at>=? AND created_at<? LIMIT 1',r.work_key,new Date(range.start).toISOString(),new Date(range.end).toISOString());
      return ownDate||r.period_ms>0||(department!=='development'&&!!notes)||!!r.running_since&&day===ctx.today;
    }).sort((a,b)=>a.report_date.localeCompare(b.report_date)||String(a.id).localeCompare(String(b.id)));
    const running=ctx.db.get('SELECT work_key FROM report_work_sessions WHERE user_id=? AND ended_at IS NULL',ctx.user.id);
    return {items,date:day,scope:mode,department,can_view_team,member_ids,server_now:ctx.now,can_add:isDevelopmentProject(project)?atLeast(ctx.user,project.vertical_id,'member')&&(canChooseWorkContact(ctx.user,project)||websiteDevelopers(project).includes(ctx.user.id))&&!['completed','cancelled'].includes(project.status):vids.some(id=>atLeast(ctx.user,id,'member')),active_work_key:all.some(r=>r.work_key===running?.work_key)?running.work_key:null};
  });
  route('GET','/daily-reporting/:id',ctx=>{
    const r=entry(ctx,ctx.params.id),totals=workTotals(ctx.db,r.work_key,ctx.now);
    const notes=ctx.db.all('SELECT n.*,u.name AS author_name FROM report_work_notes n JOIN users u ON u.id=n.user_id WHERE work_key=? ORDER BY n.id',r.work_key);
    const sessions=totals.sessions.map(s=>({...s,designer_name:ctx.db.get('SELECT name FROM users WHERE id=?',s.user_id)?.name}));
    return {...shape(ctx,r),notes,sessions,server_now:ctx.now};
  });
  route('POST','/daily-reporting',ctx=>{
    rejectManualTiming(ctx.body);const b=ctx.body;
    const title=required(b.title,'Work / content'),date=optDate(b.report_date||ctx.today,'Work date'),type=text(b.work_type,{max:60})||'Graphic',remarks=text(b.remarks,{max:8000})||'';
    if(!date)throw bad('Work date is required');
    return ctx.db.tx(()=>{
      if(!b.project_id){
        const vid=Number(b.vertical_id)||visibleVerticalIds(ctx.user).find(id=>atLeast(ctx.user,id,'member'));
        if(!vid||!atLeast(ctx.user,vid,'member'))throw forbidden('You need member access to add extra work');
        if(b.assignee_id && Number(b.assignee_id)!==ctx.user.id)throw bad('Extra work without a project is assigned to yourself');
        const label=text(b.client_label,{max:160})||'Other / extra work';
        const department=oneOf(b.reporting_team||defaultReportingDepartment(ctx.user),Object.keys(REPORTING_DEPARTMENTS),'Reporting department');
        const {id}=ctx.db.run('INSERT INTO extra_work (vertical_id,title,client_label,work_type,reporting_team,report_date,assignee_id,created_by,remarks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',vid,title,label,type,department,date,ctx.user.id,ctx.user.id,remarks,ctx.now,ctx.now);
        ctx.db.run('INSERT INTO report_work (work_key,extra_id,updated_at) VALUES (?,?,?)','extra-'+id,id,ctx.now);
        return {id:'extra-'+id,work_key:'extra-'+id};
      }
      const p=getProject(ctx,b.project_id,true);
      if(b.reporting_team&&b.reporting_team!==projectReportingDepartment(p))throw bad('This project belongs to a different reporting sheet');
      if(isDevelopmentProject(p))return call(ctx,'POST','/development-reporting',b);
      const social=socialContact(ctx,p,b),designer=person(ctx,b.assignee_id,p.vertical_id);
      if(!designer)throw bad('Choose the person who will do this work');
      assertWebsiteAssignment(ctx,p,designer);
      const due=isDevelopmentProject(p)?optDate(b.due_date||date,'Task deadline'):date;
      if(due<date)throw bad('Task deadline cannot be before its start date');
      const stage=isDevelopmentProject(p)?oneOf(b.stage||'Design',WEBSITE_STAGES,'Website phase'):undefined;
      const t=call(ctx,'POST','/projects/'+p.id+'/tasks',{title,assignee_id:designer,status:'todo',start_date:date,due_date:due,stage,description:remarks});
      ctx.db.run("INSERT INTO daily_reporting (task_id,report_date,work_type,social_id,status,remarks,created_by,updated_at) VALUES (?,?,?,?,'Not Started',?,?,?) ON CONFLICT(task_id) DO UPDATE SET report_date=excluded.report_date,work_type=excluded.work_type,social_id=excluded.social_id,remarks=excluded.remarks,created_by=excluded.created_by,updated_at=excluded.updated_at",t.id,date,type,social,remarks,ctx.user.id,ctx.now);
      ctx.db.run('INSERT OR IGNORE INTO report_work (work_key,task_id,updated_at) VALUES (?,?,?)','task-'+t.id,t.id,ctx.now);
      if(social)ctx.db.run('INSERT OR IGNORE INTO project_members (project_id,user_id) VALUES (?,?)',p.id,social);
      return {id:t.id,task_id:t.id,work_key:'task-'+t.id};
    });
  });
  route('PATCH','/daily-reporting/:id',ctx=>{
    rejectManualTiming(ctx.body);const r=entry(ctx,ctx.params.id,true),perms=permissions(ctx,r),b=ctx.body;
    if(b.reporting_team&&b.reporting_team!==rowReportingDepartment(r))throw bad('Work cannot be moved to a different reporting sheet');
    if(isDevelopmentProject(r)&&!r.parent_task_id)throw bad('Edit the main task from the project. Add daily modules in Development Reporting.');
    if(r.parent_task_id&&r.parent_status==='review')throw bad('This task is awaiting review. Daily work cannot be edited until the head requests changes.');
    if(r.parent_task_id&&((b.parent_task_id!==undefined&&Number(b.parent_task_id)!==r.parent_task_id)||(b.project_id!==undefined&&Number(b.project_id)!==r.project_id)))throw bad('Daily work stays linked to its original main task');
    if(!perms.can_edit)throw forbidden('Only the work creator, social/contact person or manager can edit the brief and assignment');
    const title=b.title===undefined?r.title:required(b.title,'Work / content'),date=optDate(b.report_date===undefined?r.report_date:b.report_date,'Date');
    if(!date)throw bad('Work date is required');
    if(r.parent_task_id&&date!==r.report_date)throw bad('The work date stays with this daily entry. Continue unfinished work into today.');
    const type=text(b.work_type===undefined?r.work_type:b.work_type,{max:60})||'Graphic',remarks=text(b.remarks===undefined?r.remarks:b.remarks,{max:8000})||'';
    const designer=b.assignee_id===undefined?r.assignee_id:person(ctx,b.assignee_id,r.vertical_id);
    if(!designer)throw bad('Choose the assigned person');
    if(designer!==r.assignee_id && ctx.db.get('SELECT id FROM report_work_sessions WHERE work_key=? AND ended_at IS NULL',r.work_key))throw bad('Ask the current assignee to pause before reassigning');
    return ctx.db.tx(()=>{
      if(r.task_id){
        const social=socialContact(ctx,r,b,r.social_id);
        assertWebsiteAssignment(ctx,r,designer);
        const due=isDevelopmentProject(r)?optDate(b.due_date===undefined?r.due_date||date:b.due_date,'Task deadline'):date;
        if(!due||due<date)throw bad('Task deadline must be on or after the start date');
        const stage=isDevelopmentProject(r)?oneOf(b.stage===undefined?r.stage:b.stage,WEBSITE_STAGES,'Website phase'):undefined;
        call({...ctx,timerTransition:true},'PATCH','/tasks/'+r.task_id,{title,assignee_id:designer,start_date:date,due_date:due,stage,description:remarks});
        ctx.db.run('UPDATE daily_reporting SET report_date=?,work_type=?,social_id=?,remarks=?,updated_at=? WHERE task_id=?',date,type,social,remarks,ctx.now,r.task_id);
        if(social)ctx.db.run('INSERT OR IGNORE INTO project_members (project_id,user_id) VALUES (?,?)',r.project_id,social);
      }else{
        if(designer!==r.assignee_id)throw bad('Your own extra work cannot be reassigned');
        ctx.db.run('UPDATE extra_work SET title=?,client_label=?,work_type=?,report_date=?,remarks=?,updated_at=? WHERE id=?',title,text(b.client_label===undefined?r.client:b.client_label,{max:160})||'Other / extra work',type,date,remarks,ctx.now,workId(r.id).extraId);
      }
      return {ok:true};
    });
  });
  route('POST','/daily-reporting/:id/notes',ctx=>{
    const r=entry(ctx,ctx.params.id,true);if(!permissions(ctx,r).can_note)throw forbidden('You are not on this work team');
    const note=required(ctx.body.note,'Note',8000);
    addWorkNote(ctx,r.work_key,note,'note',r.revision_no);
    return {ok:true};
  });
  route('POST','/daily-reporting/:id/action',ctx=>{
    const action=oneOf(ctx.body.action,['start','pause','resume','done','under_process','request_revision','reopen'],'Work action');
    if(!action)throw bad('Choose an action');
    return ctx.db.tx(()=>{
      const r=entry(ctx,ctx.params.id,true),perms=permissions(ctx,r),note=text(ctx.body.note,{max:8000})||'';
      if(isDevelopmentProject(r)&&r.parent_status==='review')throw bad('This task is awaiting review. The head must approve it or request changes first.');
      if(isDevelopmentProject(r)&&!r.parent_task_id&&!['pause','under_process'].includes(action))throw bad('Use daily modules to report work. Main tasks are managed by the head.');
      if((r.parent_task_id||r.reporting_team==='development')&&['start','resume','reopen'].includes(action)){
        if(r.parent_task_id&&r.parent_status==='done')throw bad('Ask the head to reopen the main task before starting more work');
        if(r.parent_task_id&&r.parent_assignee_id!==ctx.user.id)throw forbidden('This main task is assigned to another developer');
        if(r.report_date!==ctx.today)throw bad('Continue unfinished work into today before starting the timer');
      }
      if(action==='request_revision'){
        if(!perms.can_request_revision)throw forbidden('Only the content/contact person, creator or manager can request changes');
        if(r.status!=='Done')throw bad('Add a note to work still in progress; request a revision after Done');
        if(r.revision_pending)throw bad('A revision is already requested; add another note if needed');
        const feedback=required(note,'What needs to change?',8000);
        ctx.db.run('UPDATE report_work SET revision_pending=1,updated_at=? WHERE work_key=?',ctx.now,r.work_key);
        addWorkNote(ctx,r.work_key,feedback,'revision_request',r.revision_no+1);
        if(r.parent_task_id)syncTask(ctx,call,r,'Under process');
        notify(ctx,r,r.assignee_id,ctx.user.name+' requested changes on “'+r.title+'”');
        return {ok:true};
      }
      if(!perms.can_timer)throw forbidden('Only the assigned person can change status or operate this timer');
      let next=r.status,revision=r.revision_no;
      if(action==='start'||action==='resume'){
        if(r.status==='In Process')return {ok:true};
        if(!['Not Started','Paused','Under process'].includes(r.status))throw bad('Use Start revision to work on a completed item');
        startInterval(ctx,r.work_key,revision);next='In Process';
      }else if(action==='pause'){
        if(r.status==='Paused')return {ok:true};
        if(r.status!=='In Process')throw bad('Start this work before pausing');
        stopInterval(ctx,r.work_key);next='Paused';
      }else if(action==='under_process'){
        if(!isDevelopmentProject(r)&&r.reporting_team!=='development')throw bad('Use Pause for this work');
        if(!['In Process','Paused','Under process'].includes(r.status))throw bad('Start work before marking it Under process');
        stopInterval(ctx,r.work_key);next='Under process';
      }else if(action==='done'){
        if(r.status==='Done')return {ok:true};
        if(!['In Process','Paused','Under process'].includes(r.status))throw bad('Start this work before marking it Done');
        stopInterval(ctx,r.work_key);next='Done';
      }else if(action==='reopen'){
        if(r.status!=='Done')throw bad('Only completed work can be reopened for revision');
        if(!r.revision_pending&&!note.trim())throw bad('Add a revision note before restarting completed work');
        revision++;
        if(note.trim())addWorkNote(ctx,r.work_key,note,'revision_request',revision);
        startInterval(ctx,r.work_key,revision);next='In Process';
      }
      const first=r.first_started_at||((next==='In Process')?ctx.now:null);
      ctx.db.run('UPDATE report_work SET state=?,first_started_at=?,completed_at=?,revision_no=?,revision_pending=?,updated_at=? WHERE work_key=?',next,first,next==='Done'?ctx.now:null,revision,action==='reopen'?0:r.revision_pending,ctx.now,r.work_key);
      syncTask(ctx,call,r,next);
      addWorkNote(ctx,r.work_key,action+(note?' · '+note:''),'event',revision);
      if(next==='Done')notify(ctx,r,r.social_id||r.owner_id,ctx.user.name+' completed “'+r.title+'”');
      return {ok:true};
    });
  });
}
