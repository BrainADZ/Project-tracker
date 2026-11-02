
import {useState} from 'react';
import {Check,Send,MessageSquare,ExternalLink} from 'lucide-react';
import {useApp} from '../store.jsx';
import {api} from '../api.js';
import {Modal,Field,ErrorNote} from '../ui.jsx';
import {stamp} from '../report-utils.js';

export default function WebsiteTaskReview({task,onChanged,compact=false,showHistory=false}){
 const {toast,bumpCounts}=useApp();
 const [form,setForm]=useState(''),[note,setNote]=useState(''),[url,setUrl]=useState(''),[confirmed,setConfirmed]=useState(false),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const review=task.review,latest=review?.latest;
 if(!review)return null;
 const open=kind=>{setError(null);setNote('');setUrl('');setFeedback('');setConfirmed(false);setForm(kind);};
 const finish=()=>{setForm('');bumpCounts();onChanged?.();};
 const approve=async()=>{
  setBusy(true);setError(null);
  try{await api.post('/tasks/'+task.id+'/review',{review_id:latest.id,decision:'approve'});toast('Task approved and completed.','success');finish();}
  catch(e){toast(e.message,'error');}finally{setBusy(false);}
 };
 const submit=async e=>{
  e.preventDefault();setBusy(true);setError(null);
  try{
   if(form==='submit')await api.post('/tasks/'+task.id+'/submit-review',{note,preview_url:url,all_modules_complete:confirmed});
   else await api.post('/tasks/'+task.id+'/review',{review_id:latest.id,decision:'changes_required',feedback});
   toast(form==='submit'?'Task sent to the head for review.':'Changes sent to the developer.','success');finish();
  }catch(e){setError(e);}finally{setBusy(false);}
 };
 const pending=latest?.status==='pending';
 return <div className={'website-task-review '+(compact?'compact':'')}>
  {pending&&!compact&&<div className="small"><b>Ready for review</b><div className="xs muted mt-4">Submitted by {latest.submitted_by_name} · {stamp(latest.submitted_at)}</div>{latest.note&&<p className="mt-8 review-feedback">{latest.note}</p>}</div>}
  {latest?.preview_url&&pending&&<a className="link small review-preview" href={latest.preview_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/>Preview / testing link</a>}
  {latest?.status==='changes_required'&&task.status!=='done'&&<div className="review-feedback small"><b className="red">Changes required</b><p className="mt-4">{latest.feedback}</p></div>}
  {latest?.status==='approved'&&task.status==='done'&&!compact&&<p className="small green">Approved by {latest.reviewed_by_name} · {stamp(latest.reviewed_at)}</p>}
  <div className="row wrap gap-6">
   {review.can_review&&<><button className="btn sm success" disabled={busy} onClick={approve}><Check size={13}/>Approve</button><button className="btn sm" disabled={busy} onClick={()=>open('changes')}><MessageSquare size={13}/>Changes required</button></>}
   {review.is_assignee&&task.status!=='done'&&!pending&&<button className="btn sm primary" disabled={!review.can_submit||busy} title={review.blocker||'Confirm all modules are complete and submit'} onClick={()=>open('submit')}><Send size={13}/>Submit task for review</button>}
   {review.is_assignee&&pending&&<span className="small muted">Waiting for head’s review</span>}
  </div>
  {review.is_assignee&&task.status!=='done'&&!pending&&!review.can_submit&&review.blocker&&<p className="xs muted mt-4">{review.blocker}</p>}
  {showHistory&&review.history?.length>0&&<details className="mt-12"><summary className="small muted">Submission history ({review.rounds})</summary>{review.history.map(r=><div className="work-note" key={r.id}><div className="row wrap between"><b>{r.status==='pending'?'Ready for review':r.status==='approved'?'Approved':'Changes required'}</b><small className="muted">{stamp(r.submitted_at)}</small></div><p className="small mt-4">Submitted by {r.submitted_by_name}</p>{r.note&&<p className="review-feedback">{r.note}</p>}{r.preview_url&&<a className="link small" href={r.preview_url} target="_blank" rel="noopener noreferrer">Preview / testing link</a>}{r.reviewed_at&&<p className="small muted mt-8">{r.reviewed_by_name} · {stamp(r.reviewed_at)}</p>}{r.feedback&&<p className="review-feedback">{r.feedback}</p>}</div>)}</details>}
  {form&&<Modal title={form==='submit'?'Submit task for review':'Changes required'} sub={task.title} onClose={()=>!busy&&setForm('')} footer={<><button className="btn" disabled={busy} onClick={()=>setForm('')}>Cancel</button><button className="btn primary" type="submit" form={'task-review-form-'+task.id} disabled={busy||form==='submit'&&!confirmed}>{busy?'Saving…':form==='submit'?'Submit for review':'Send changes'}</button></>}><form id={'task-review-form-'+task.id} className="modal-body col gap-12" onSubmit={submit}><ErrorNote error={error}/>{form==='submit'?<><Field label="Completion note"><textarea className="input" rows={3} maxLength={8000} value={note} onChange={e=>setNote(e.target.value)} placeholder="What is complete and what did you test?"/></Field><Field label="Preview / testing link (optional)"><input className="input" type="url" maxLength={2000} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></Field><label className="check review-confirm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I confirm all modules of this main task are complete and ready for review.</span></label></>:<Field label="What needs to change?"><textarea className="input" required rows={4} maxLength={8000} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Give the developer clear feedback"/></Field>}</form></Modal>}
 </div>;
}
