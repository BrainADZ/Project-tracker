
import {useState,useEffect} from 'react';
import {Plus,Download,Play,Pause,Check,ArrowRight,MessageSquare,Pencil} from 'lucide-react';
import {useApp,useLoad} from '../store.jsx';
import {api} from '../api.js';
import {Link} from '../router.jsx';
import {Modal,Field,Loading,ErrorNote,Empty} from '../ui.jsx';
import {fmtDate} from '../format.js';
import {duration,clock,stamp} from '../report-utils.js';
import WebsiteTaskReview from './WebsiteTaskReview.jsx';
import WorkNotes from './WorkNotes.jsx';

export default function DevelopmentReporting({projectId,embedded=false,initialDate,onSeen}){
 const {today,me,users,toast,refresh,bumpCounts,verticals}=useApp();
 const [date,setDate]=useState(initialDate||today),[scope,setScope]=useState('day'),[person,setPerson]=useState(''),[search,setSearch]=useState(''),[form,setForm]=useState(null),[f,setF]=useState({}),[error,setError]=useState(null),[saving,setSaving]=useState(false),[busy,setBusy]=useState(''),[notes,setNotes]=useState(null),[now,setNow]=useState(Date.now());
 const report=useLoad(()=>api.get('/daily-reporting',{department:'development',date,scope,project:projectId}),[date,scope,projectId]);
 const options=useLoad(()=>api.get('/development-reporting/options'),[]);
 const pending=useLoad(()=>api.get('/development-reporting/pending',{project:projectId}),[projectId,date]);
 const [offset,setOffset]=useState(0);
 useEffect(()=>{if(report.data?.server_now)setOffset(Date.parse(report.data.server_now)-Date.now());},[report.data?.server_now]);
 useEffect(()=>{const tick=setInterval(()=>setNow(Date.now()),1000),poll=setInterval(()=>{if(document.visibilityState==='visible'){report.reload({quiet:true});pending.reload({quiet:true});options.reload({quiet:true});}},4000);return()=>{clearInterval(tick);clearInterval(poll);};},[report.reload,pending.reload]);
 useEffect(()=>{if(report.data)onSeen?.();},[!!report.data]);
 const team=!!report.data?.can_view_team,people=users.filter(u=>report.data?.member_ids?.includes(u.id));
 const items=(report.data?.items||[]).filter(r=>(!team||!person||r.assignee_id===Number(person))&&(!search||(r.project_name+' '+r.parent_task_title+' '+r.title).toLowerCase().includes(search.toLowerCase())));
 const projects=(options.data?.projects||[]).filter(p=>(!projectId||p.id===Number(projectId))&&p.tasks.length>0);
 const reviewTasks=(options.data?.projects||[]).filter(p=>!projectId||p.id===Number(projectId)).flatMap(p=>p.review_tasks||[]).filter(t=>t.review?.can_submit||['pending','changes_required'].includes(t.review?.latest?.status));
 const selected=projects.find(p=>p.id===Number(f.project_id));
 const elapsed=r=>(r.total_ms||0)+(r.running_since?Math.max(0,now+offset-Date.parse(r.running_since)):0);
 const changed=()=>{report.reload({quiet:true});pending.reload({quiet:true});options.reload({quiet:true});refresh();bumpCounts();};
 const act=async(r,action)=>{setBusy(String(r.id));try{await api.post('/daily-reporting/'+r.id+'/action',{action});changed();}catch(e){toast(e.message,'error');}finally{setBusy('');}};
 const carry=async r=>{setBusy(String(r.id));try{await api.post('/development-reporting/'+r.id+'/continue');setDate(today);setScope('day');changed();toast('Added to today. Press Start when you begin.','success');}catch(e){toast(e.message,'error');}finally{setBusy('');}};
 const open=row=>{
  const p=projects.find(p=>p.id===Number(projectId))||projects[0];
  setError(null);setForm(row||'new');
  setF(row?{project_id:row.project_id||'',parent_task_id:row.parent_task_id||'',title:row.title,remarks:row.remarks||'',report_date:row.report_date,client_label:row.client||''}:{project_id:p?.id||'',parent_task_id:p?.tasks[0]?.id||'',title:'',remarks:'',report_date:today,client_label:''});
 };
 const set=k=>e=>setF(x=>({...x,[k]:e.target.value}));
 const chooseProject=id=>{const p=projects.find(p=>p.id===Number(id));setF(x=>({...x,project_id:id,parent_task_id:p?.tasks[0]?.id||''}));};
 const save=async e=>{
  e.preventDefault();setSaving(true);setError(null);
  try{
   if(form==='new'){
    if(f.project_id)await api.post('/development-reporting',f);
    else await api.post('/daily-reporting',{...f,reporting_team:'development',work_type:'Development',vertical_id:verticals.find(v=>['member','manager'].includes(me.access?.[v.id]))?.id});
   }else await api.patch('/daily-reporting/'+form.id,{title:f.title,remarks:f.remarks,report_date:f.report_date});
   setForm(null);setDate(f.report_date);setScope('day');changed();
  }catch(e){setError(e);}finally{setSaving(false);}
 };
 const exportRows=()=>{
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const rows=[['Date','Client / project','Main task','Module / today work','Developer','Start','Completed','Status','Active time','Notes'],
   ...items.map(r=>[r.report_date,r.project_name,r.parent_task_title||(r.task_id?r.title:'Extra work'),r.title,r.designer_name,stamp(r.first_started_at),stamp(r.completed_at),r.status,duration(elapsed(r)),r.last_note||r.remarks])];
  api.saveText('development-reporting-'+date+'.csv','\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')).catch(e=>toast(e.message,'error'));
 };
 return <>
  <div className="page-head"><div>{embedded?<h2>Daily development work</h2>:<h1>Development Reporting</h1>}<div className="sub">{team?'Team daily modules and active time. Main tasks are managed from Projects.':'Choose your project and main task, then add the module you are working on today.'}</div></div><div className="head-actions"><button className="btn" disabled={!items.length} onClick={exportRows}><Download size={16}/>Export</button>{(projects.length>0||options.data?.can_add_extra)&&<button className="btn primary" onClick={()=>open(null)}><Plus size={16}/>Add today’s work</button>}</div></div>
  <ErrorNote error={report.error||options.error||pending.error} retry={()=>{report.reload();options.reload();pending.reload();}}/>
  {!embedded&&<div className="daily-stats">{[[scope==='day'&&date===today?'Today’s entries':'Work entries',items.length],['Running',items.filter(r=>r.running_since).length],['Under process',items.filter(r=>['Under process','Paused'].includes(r.status)).length],['Done',items.filter(r=>r.status==='Done').length]].map(([title,n])=><div className="card" key={title}><span className="small muted">{title}</span><b>{n}</b></div>)}</div>}
  <div className="filters mb-16 daily-filters"><input type="date" className="input" aria-label="Reporting date" value={date} onChange={e=>e.target.value&&setDate(e.target.value)}/><select className="select" aria-label="Reporting period" value={scope} onChange={e=>setScope(e.target.value)}><option value="day">This date</option><option value="month">Full month</option></select><input className="input" aria-label="Search reporting" placeholder="Search project, task or module" value={search} onChange={e=>setSearch(e.target.value)}/>{team&&<select className="select" aria-label="Filter team member" value={person} onChange={e=>setPerson(e.target.value)}><option value="">All team members</option>{people.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>}</div>
  {!!reviewTasks.length&&<section className="card mb-16"><h3>Main task completion</h3><p className="small muted mt-4">Submit the main task after all current modules are complete. The head reviews your submission.</p>{reviewTasks.map(t=><div className="development-review-row" key={t.id}><div><Link className="b6" to={'/projects/'+t.project_id+'/tasks/'+t.id}>{t.title}</Link><p className="small muted mt-4">{t.project_name}</p></div><WebsiteTaskReview task={t} onChanged={changed}/></div>)}</section>}
  {report.loading&&!report.data?<Loading/>:<div className="card flush"><div className="table-wrap"><table className="table development-sheet"><thead><tr><th>Date</th><th>Project</th><th>Main task</th><th>Module / today’s work</th>{team&&<th>Developer</th>}<th>Start</th><th>Completed</th><th>Status</th><th>Total time</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{items.map(r=>{
   const disabled=busy===String(r.id),legacy=r.task_id&&!r.parent_task_id;
   return <tr key={r.work_key}><td className="nowrap">{fmtDate(r.report_date)}</td><td>{r.project_id?<Link to={'/projects/'+r.project_id}>{r.project_name}</Link>:<b>{r.client||'Extra work'}</b>}</td><td>{r.project_id?<Link to={'/projects/'+r.project_id+'/tasks/'+(r.parent_task_id||r.task_id)}>{r.parent_task_title||r.title}</Link>:'Extra work'}</td><td><b>{r.title}</b>{legacy&&<div className="xs muted">Earlier work history</div>}</td>{team&&<td>{r.designer_name}</td>}<td className="report-time-cell">{clock(r.first_started_at)}</td><td className="report-time-cell">{clock(r.completed_at)}</td><td><span className={'badge '+(r.status==='Done'?'b-blue':r.status==='In Process'?'b-green':r.status==='Under process'||r.status==='Paused'?'b-amber':'b-gray')}>{r.status==='In Process'?'Running':r.status}</span>{!!r.revision_pending&&<div className="xs red mt-4">Changes requested</div>}</td><td className="work-total"><b>{duration(elapsed(r))}</b></td><td className="work-note-cell"><button className="link small" onClick={()=>setNotes(r.id)}><MessageSquare size={13}/>{r.note_count?r.note_count+' notes':'Notes'}</button><p className="xs muted">{r.last_note||r.remarks||'—'}</p></td><td><div className="work-controls">
    {r.can_timer&&!legacy&&r.report_date===today&&<>
     {r.status==='Not Started'&&<button className="btn sm primary" disabled={disabled} onClick={()=>act(r,'start')}><Play size={12}/>Start</button>}
     {['Paused','Under process'].includes(r.status)&&<button className="btn sm primary" disabled={disabled} onClick={()=>act(r,'resume')}><Play size={12}/>Resume</button>}
     {r.status==='In Process'&&<button className="btn sm" disabled={disabled} onClick={()=>act(r,'pause')}><Pause size={12}/>Pause</button>}
     {['In Process','Paused','Under process'].includes(r.status)&&<><button className="btn sm" disabled={disabled} onClick={()=>act(r,'under_process')}>Under process</button><button className="btn sm success" disabled={disabled} onClick={()=>act(r,'done')}><Check size={12}/>Done today</button></>}
     {r.status==='Done'&&<button className="btn sm" disabled={disabled} onClick={()=>r.revision_pending?act(r,'reopen'):setNotes(r.id)}>{r.revision_pending?'Start revision':'Notes / changes'}</button>}
    </>}
    {r.can_timer&&r.status==='In Process'&&(legacy||r.report_date!==today)&&<button className="btn sm" disabled={disabled} onClick={()=>act(r,'under_process')}>Under process</button>}
    {r.can_continue&&<button className="btn sm primary" disabled={disabled} onClick={()=>carry(r)}><ArrowRight size={12}/>Continue today</button>}
    {r.can_edit&&!legacy&&<button className="icon-btn" title="Edit daily module" onClick={()=>open(r)}><Pencil size={14}/></button>}
   </div></td></tr>;
  })}</tbody></table></div>{!items.length&&<Empty title="No daily work for this date">Main tasks appear in Projects. Add today’s module here when you begin work.</Empty>}</div>}
  {!!pending.data?.items?.length&&<section className="card mt-16"><h3>Continue unfinished work</h3><p className="small muted mt-4">Previous entries keep their dates and time. Continue creates a new entry for today.</p>{pending.data.items.map(r=><div className="list-item development-carry" key={r.id}><div><b>{r.title}</b><div className="small muted">{r.project_name} · {r.parent_task_title} · {fmtDate(r.report_date)}</div></div><button className="btn sm" disabled={busy===String(r.id)} onClick={()=>carry(r)}><ArrowRight size={13}/>Continue today</button></div>)}</section>}
  {form&&<Modal title={form==='new'?'Add today’s work':'Edit daily module'} sub="Daily completion records this module only. The head manages the main task." onClose={()=>setForm(null)} footer={<><button className="btn" onClick={()=>setForm(null)}>Cancel</button><button className="btn primary" form="development-entry-form" type="submit" disabled={saving}>{saving?'Saving…':'Add / save work'}</button></>}><form id="development-entry-form" className="modal-body form-grid" onSubmit={save}><div className="full"><ErrorNote error={error}/></div><Field label="Project"><select className="select" required={!!f.project_id} disabled={form!=='new'} value={f.project_id} onChange={e=>chooseProject(e.target.value)}><option value="">Other / extra work</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}{form!=='new'&&f.project_id&&!selected&&<option value={f.project_id}>{form.project_name}</option>}</select></Field><Field label="Work date"><input type="date" className="input" required max={today} disabled={form!=='new'} value={f.report_date} onChange={set('report_date')}/></Field>{f.project_id&&<Field label="Assigned main task" className="full"><select className="select" required disabled={form!=='new'} value={f.parent_task_id} onChange={set('parent_task_id')}><option value="">Choose your task</option>{selected?.tasks.map(t=><option key={t.id} value={t.id}>{t.title} · {t.stage}</option>)}{form!=='new'&&!selected?.tasks.some(t=>t.id===Number(f.parent_task_id))&&<option value={f.parent_task_id}>{form.parent_task_title}</option>}</select></Field>}<Field label="Module / today’s work" className="full"><input className="input" required maxLength={240} value={f.title} onChange={set('title')} placeholder="e.g. UI design — homepage header and mobile navigation"/></Field><Field label="Notes" className="full"><textarea className="input" rows={3} maxLength={8000} value={f.remarks} onChange={set('remarks')} placeholder="Progress, blockers or what is left for the next day"/></Field></form></Modal>}
  {notes&&<WorkNotes id={notes} department="development" onClose={()=>setNotes(null)} onChanged={changed}/>}
 </>;
}
