
import {bad,forbidden,notFound,toId,text,oneOf,parseJSON} from '../services/util.js';
import {atLeast,canView,loadUser} from '../models/access.js';
import {canChooseWorkContact,websiteDevelopers} from '../services/project-services.js';

export function pendingWebsiteReview(db,taskId){
 return db.get("SELECT * FROM website_task_reviews WHERE task_id=? AND status='pending'",taskId);
}
export function websiteTaskReview(ctx,task,project,{history=false}={}){
 const rows=ctx.db.all('SELECT r.*,s.name submitted_by_name,h.name reviewed_by_name FROM website_task_reviews r JOIN users s ON s.id=r.submitted_by LEFT JOIN users h ON h.id=r.reviewed_by WHERE r.task_id=? ORDER BY r.id DESC',task.id);
 const latest=rows[0]||null,pending=rows.find(r=>r.status==='pending')||null;
 const current=ctx.db.all("SELECT e.id,w.state,w.revision_pending FROM extra_work e JOIN report_work w ON w.extra_id=e.id WHERE e.parent_task_id=? AND e.assignee_id=? AND NOT EXISTS (SELECT 1 FROM extra_work n WHERE n.parent_task_id=e.parent_task_id AND n.continued_from_key='extra-'||e.id)",task.id,task.assignee_id);
 const running=!!ctx.db.get('SELECT s.id FROM report_work_sessions s JOIN report_work w ON w.work_key=s.work_key LEFT JOIN extra_work e ON e.id=w.extra_id WHERE s.ended_at IS NULL AND (w.task_id=? OR e.parent_task_id=?) LIMIT 1',task.id,task.id);
 const unfinished=current.filter(r=>r.state!=='Done'||r.revision_pending).length;
 const legacy=ctx.db.get('SELECT w.state,w.revision_pending FROM report_work w WHERE w.task_id=? AND EXISTS (SELECT 1 FROM report_work_sessions s WHERE s.work_key=w.work_key)',task.id);
 const hasCompletedWork=current.some(r=>r.state==='Done'&&!r.revision_pending)||!current.length&&legacy?.state==='Done'&&!legacy.revision_pending;
 const open=atLeast(ctx.user,project.vertical_id,'member')&&!['completed','cancelled'].includes(project.status);
 const is_assignee=task.assignee_id===ctx.user.id&&websiteDevelopers(project).includes(ctx.user.id);
 let blocker='';
 if(!open)blocker='This project is closed or read-only.';
 else if(task.status==='done')blocker='This main task is already complete.';
 else if(pending)blocker='Waiting for the head to review this submission.';
 else if(running)blocker='Stop running timers before submitting this task.';
 else if(unfinished)blocker='Complete your '+unfinished+' current module'+(unfinished===1?'':'s')+' before submitting.';
 else if(!hasCompletedWork)blocker='Complete daily module work before submitting this task.';
 return {latest,rounds:rows.length,is_assignee,can_submit:open&&is_assignee&&!blocker,can_review:open&&!!pending&&canChooseWorkContact(ctx.user,project),blocker,pending_modules:unfinished,...(history?{history:rows}:{})};
}
function context(ctx){
 const task=ctx.db.get('SELECT * FROM tasks WHERE id=?',toId(ctx.params.id,'Main task'));
 const project=task&&ctx.db.get("SELECT * FROM projects WHERE id=? AND service_type IN ('website','software')",task.project_id);
 if(!project||!canView(ctx.user,project))throw notFound('Task');
 if(!atLeast(ctx.user,project.vertical_id,'member'))throw forbidden('You have view-only access');
 if(['completed','cancelled'].includes(project.status))throw bad('Reopen the project before reviewing tasks');
 return {task,project};
}
function notify(ctx,userId,p,task,message){
 if(!userId||userId===ctx.user.id)return;
 const person=loadUser(ctx.db,userId);
 if(!person||!canView(person,p))return;
 ctx.db.run('INSERT INTO notifications (user_id,project_id,task_id,text,link,created_at) VALUES (?,?,?,?,?,?)',userId,p.id,task.id,message,'/projects/'+p.id+'/tasks/'+task.id,ctx.now);
}
function activity(ctx,p,t,action,detail){
 ctx.db.run('INSERT INTO activity (project_id,task_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?,?)',p.id,t.id,ctx.user.id,action,detail,ctx.now);
}
export function registerWebsiteTaskReviews(route,call){
 route('POST','/tasks/:id/submit-review',ctx=>ctx.db.tx(()=>{
  const {task,project}=context(ctx);
  if(task.assignee_id!==ctx.user.id||!websiteDevelopers(project).includes(ctx.user.id))throw forbidden('Only the assigned developer can submit this task');
  if(ctx.body.all_modules_complete!==true)throw bad('Confirm that all modules of this main task are complete');
  const note=text(ctx.body.note,{max:8000,label:'Completion note'})||'';
  const preview_url=text(ctx.body.preview_url,{max:2000,label:'Preview / testing link'})||'';
  if(preview_url){let parsed;try{parsed=new URL(preview_url);}catch{throw bad('Use a valid http:// or https:// preview link');}if(!['http:','https:'].includes(parsed.protocol))throw bad('Use an http:// or https:// preview link');}
  const pending=pendingWebsiteReview(ctx.db,task.id);
  if(pending){if(task.status!=='review')throw bad('This task changed after submission. Refresh before continuing.');return {ok:true,review_id:pending.id,status:'review',already_submitted:true};}
  const review=websiteTaskReview(ctx,task,project);
  if(!review.can_submit)throw bad(review.blocker||'This task cannot be submitted');
  const {id}=ctx.db.run('INSERT INTO website_task_reviews (task_id,submitted_by,submitted_at,note,preview_url) VALUES (?,?,?,?,?)',task.id,ctx.user.id,ctx.now,note,preview_url);
  call({...ctx,reviewTransition:true},'PATCH','/tasks/'+task.id,{status:'review'});
  activity(ctx,project,task,'task_submitted','Submitted for review: '+task.title+(note?' · '+note:''));
  const details=parseJSON(project.service_details,{});
  const recipients=new Set([project.owner_id,details.head_id,details.manager_id].filter(Boolean));
  for(const id of recipients)notify(ctx,id,project,task,ctx.user.name+' submitted “'+task.title+'” for review');
  return {ok:true,review_id:id,status:'review'};
 }));
 route('POST','/tasks/:id/review',ctx=>ctx.db.tx(()=>{
  const {task,project}=context(ctx);
  if(!canChooseWorkContact(ctx.user,project))throw forbidden('Only the development head or manager can approve or request changes');
  const decision=oneOf(ctx.body.decision,['approve','changes_required'],'Review decision');
  if(!decision)throw bad('Choose Approve or Changes required');
  const reviewId=toId(ctx.body.review_id,'Submission');
  const feedback=text(ctx.body.feedback,{max:8000,label:'Review feedback'})||'';
  if(decision==='changes_required'&&!feedback)throw bad('Describe the changes required');
  const pending=pendingWebsiteReview(ctx.db,task.id);
  if(!pending){
   const previous=ctx.db.get('SELECT * FROM website_task_reviews WHERE id=? AND task_id=?',reviewId,task.id);
   const latest=ctx.db.get('SELECT id FROM website_task_reviews WHERE task_id=? ORDER BY id DESC LIMIT 1',task.id);
   if(previous?.id===latest?.id&&previous?.status===(decision==='approve'?'approved':'changes_required')&&task.status===(decision==='approve'?'done':'in_progress'))return {ok:true,status:task.status,already_reviewed:true};
   throw bad('This submission has already been reviewed. Refresh to see its current status.');
  }
  if(pending.id!==reviewId)throw bad('A newer submission is waiting for review. Refresh before deciding.');
  if(task.status!=='review')throw bad('This task is no longer waiting for review');
  if(decision==='approve'){
   const ready=websiteTaskReview(ctx,task,project);
   if(ready.pending_modules||ctx.db.get('SELECT s.id FROM report_work_sessions s JOIN report_work w ON w.work_key=s.work_key LEFT JOIN extra_work e ON e.id=w.extra_id WHERE s.ended_at IS NULL AND (w.task_id=? OR e.parent_task_id=?) LIMIT 1',task.id,task.id))throw bad('Daily work changed during review. Request changes before approval.');
  }
  const state=decision==='approve'?'approved':'changes_required',status=decision==='approve'?'done':'in_progress';
  ctx.db.run('UPDATE website_task_reviews SET status=?,reviewed_by=?,reviewed_at=?,feedback=? WHERE id=?',state,ctx.user.id,ctx.now,feedback,pending.id);
  call({...ctx,reviewTransition:true},'PATCH','/tasks/'+task.id,{status});
  activity(ctx,project,task,decision==='approve'?'task_review_approved':'task_changes_requested',(decision==='approve'?'Approved: ':'Changes required: ')+task.title+(feedback?' · '+feedback:''));
  notify(ctx,task.assignee_id,project,task,ctx.user.name+(decision==='approve'?' approved “':' requested changes on “')+task.title+'”'+(feedback?' · '+feedback.slice(0,240)+(feedback.length>240?'…':''):''));
  return {ok:true,review_id:pending.id,status};
 }));
}
