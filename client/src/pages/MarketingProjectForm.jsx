import { useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, UserSelect } from '../ui.jsx';
import { SERVICE_TYPES, websiteDevelopers, isDevelopmentProject } from '../../../shared/project-services.js';

export function MarketingProjectForm({project,copyFrom,initialName,initialStatus,initialService='',serviceChoices,onFieldChange,verticalId,onVerticalChange,onClose,onSaved}) {
  const {me,today,manageableVerticals,assignable,toast}=useApp();
  const source=project || copyFrom;
  const [f,setF]=useState(()=>({
    service_type:source?.service_type || initialService,name:source?.name || initialName || '',client:source?.client || '',description:source?.description || '',
    owner_id:source?.owner_id || me.id,start_date:project?.start_date || today,due_date:project?.due_date || '',status:project?.status || initialStatus || 'active',health:project?.health || 'on_track',
    ...source?.service_details,monthly_target:source?.service_details?.monthly_target ?? 15,platforms:source?.service_details?.platforms || '',
    application_type:source?.service_details?.application_type || '',website_url:source?.service_details?.website_url || '',page_count:source?.service_details?.page_count || '',technology:source?.service_details?.technology || '',
    keyword_count:source?.service_details?.keyword_count || '',monthly_ad_budget:source?.service_details?.monthly_ad_budget || '',objective:source?.service_details?.objective || '',deliverables:source?.service_details?.deliverables || '',
    lead_id:source?.service_details?.lead_id || '',specialist_id:source?.service_details?.specialist_id || '',manager_id:source?.service_details?.manager_id || source?.owner_id || me.id,
    head_id:source?.service_details?.head_id || source?.service_details?.manager_id || source?.owner_id || me.id,developer_ids:websiteDevelopers(source),sales_id:source?.service_details?.sales_id || '',
  }));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const people=assignable(Number(verticalId)),website=isDevelopmentProject(f);
  const choices=serviceChoices || Object.fromEntries(Object.entries(SERVICE_TYPES).filter(([key])=>key!=='software'));
  const set=k=>e=>setF(x=>({...x,[k]:e.target.value}));
  const submit=async e=>{
    e.preventDefault();setError('');
    if(!f.service_type)return setError('Choose a project field first');
    if(website&&(!f.head_id||!f.developer_ids.length))return setError('Choose one head and at least one developer');
    setBusy(true);
    const common=website?{head_id:f.head_id,developer_ids:f.developer_ids,sales_id:f.sales_id}:{lead_id:f.lead_id,specialist_id:f.specialist_id,manager_id:f.manager_id,sales_id:f.sales_id};
    const specific=f.service_type==='social'?{monthly_target:f.monthly_target,platforms:f.platforms}:f.service_type==='software'?{application_type:f.application_type,technology:f.technology}:website?{website_url:f.website_url,page_count:f.page_count,technology:f.technology}:f.service_type==='seo'?{website_url:f.website_url,keyword_count:f.keyword_count,deliverables:f.deliverables}:{platforms:f.platforms,monthly_ad_budget:f.monthly_ad_budget,objective:f.objective};
    const owner=Number(website?f.head_id:f.manager_id || f.owner_id || me.id);
    const team=[...new Set((website?[owner,...f.developer_ids,f.sales_id]:[owner,...Object.values(common)]).filter(Boolean).map(Number))];
    const body={vertical_id:Number(verticalId),name:f.name,client:f.client,description:f.description,owner_id:owner,start_date:f.start_date || null,due_date:f.due_date || null,status:f.status,health:f.health,service_type:f.service_type,service_details:{...common,...specific},member_ids:team};
    try {
      const saved=project?await api.patch('/projects/'+project.id,body):await api.post('/projects',body);
      if(project&&!website)await api.put('/projects/'+project.id+'/members',{user_ids:[...new Set([...(project.members || []).map(u=>u.id),...team])]});
      toast(project?'Project updated':'Project added','success');onSaved(saved);
    }catch(e){setError(e.message);setBusy(false);}
  };
  const role=(key,label)=><Field label={label}><UserSelect value={f[key] || null} onChange={value=>setF(x=>({...x,[key]:value}))} people={people} placeholder="Choose person" /></Field>;
  return <Modal title={project?'Edit project':'Add project'} onClose={onClose} size="wide" footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="service-project" className="btn primary" disabled={busy || !f.service_type}>{busy?'Saving…':project?'Save changes':'Add project'}</button></>}>
    <form id="service-project" className="modal-body" onSubmit={submit}>
      {error&&<div className="alert error mb-16">{error}</div>}
      <Field label="Project field"><div className={'service-choices '+(Object.keys(choices).length===1?'single-choice':'')}>{Object.entries(choices).map(([key,name])=><button type="button" className={f.service_type===key?'selected':''} key={key} onClick={()=>setF(x=>({...x,service_type:key}))}>{name}</button>)}</div>{onFieldChange&&<button type="button" className="link mt-8" onClick={onFieldChange}>Change project field</button>}</Field>
      {manageableVerticals.length>1&&!project&&<Field label="Vertical" className="mt-16"><select className="select" value={verticalId} onChange={e=>{onVerticalChange(Number(e.target.value));setF(x=>({...x,developer_ids:[],head_id:'',sales_id:''}));}}>{manageableVerticals.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>}
      {f.service_type&&<div className="form-grid mt-16">
        <Field label="Client / brand"><input className="input" required maxLength={160} value={f.client} onChange={set('client')} placeholder="Client name"/></Field>
        <Field label="Project name"><input className="input" required maxLength={160} value={f.name} onChange={set('name')} placeholder={f.client?f.client+' — '+SERVICE_TYPES[f.service_type]:SERVICE_TYPES[f.service_type]+' project'}/></Field>
        {f.service_type==='social'&&<><Field label="Monthly creative target"><input className="input" type="number" min="1" required value={f.monthly_target} onChange={set('monthly_target')}/></Field><Field label="Platforms"><input className="input" value={f.platforms} onChange={set('platforms')} placeholder="Instagram, Facebook, LinkedIn"/></Field></>}
        {f.service_type==='website'&&<><Field label="Website / domain"><input className="input" value={f.website_url} onChange={set('website_url')} placeholder="example.com"/></Field><Field label="Number of pages"><input className="input" type="number" min="1" value={f.page_count} onChange={set('page_count')}/></Field><Field label="Platform / technology" className="full"><input className="input" value={f.technology} onChange={set('technology')} placeholder="WordPress, Shopify, custom…"/></Field></>}
        {f.service_type==='software'&&<><Field label="Application type"><input className="input" value={f.application_type} onChange={set('application_type')} placeholder="Web app, mobile app, internal software…" maxLength={500}/></Field><Field label="Technology"><input className="input" value={f.technology} onChange={set('technology')} placeholder="React, Node.js, Flutter…" maxLength={500}/></Field></>}
        {f.service_type==='seo'&&<><Field label="Website"><input className="input" value={f.website_url} onChange={set('website_url')} placeholder="example.com"/></Field><Field label="Keywords to track"><input className="input" type="number" min="0" value={f.keyword_count} onChange={set('keyword_count')}/></Field><Field label="Monthly SEO deliverables" className="full"><input className="input" value={f.deliverables} onChange={set('deliverables')} placeholder="Blogs, backlinks, on-page fixes…"/></Field></>}
        {f.service_type==='ads'&&<><Field label="Ad platforms"><input className="input" value={f.platforms} onChange={set('platforms')} placeholder="Meta Ads, Google Ads…"/></Field><Field label="Monthly ad budget (₹)"><input className="input" type="number" min="0" value={f.monthly_ad_budget} onChange={set('monthly_ad_budget')}/></Field><Field label="Campaign objective" className="full"><input className="input" value={f.objective} onChange={set('objective')} placeholder="Leads, sales, awareness…"/></Field></>}
        <Field label="Start date"><input className="input" type="date" value={f.start_date} onChange={set('start_date')}/></Field>
        <Field label={f.service_type==='social'?'Contract end date (optional)':website?'Delivery deadline':'Due / end date'}><input className="input" type="date" min={f.start_date} value={f.due_date} onChange={set('due_date')}/></Field>
        <div className="form-section">Project team</div>
        {website?<>{role('head_id',f.service_type==='software'?'Software head':'Website head')}{role('sales_id','Sales person (whose client)')}
          <Field label={'Developers · '+f.developer_ids.length+' selected'} className="full"><div className="website-developer-picker">{people.map(u=><label className={'website-developer-option '+(f.developer_ids.includes(u.id)?'selected':'')} key={u.id}><input type="checkbox" checked={f.developer_ids.includes(u.id)} onChange={e=>setF(x=>({...x,developer_ids:e.target.checked?[...x.developer_ids,u.id]:x.developer_ids.filter(id=>id!==u.id)}))}/><span>{u.name}<small>{u.title}</small></span></label>)}</div></Field>
        </>:<>{role('lead_id',f.service_type==='social'?'Social / content person (client contact)':'Project lead / client contact')}{role('specialist_id',{social:'Designer',seo:'SEO executive',ads:'Ads executive'}[f.service_type])}{role('manager_id','Marketing manager')}{role('sales_id','Sales person (whose client)')}</>}
        {project&&<Field label="Status"><select className="select" value={f.status} onChange={set('status')}>{['planning','active','on_hold','completed','cancelled'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></Field>}
        <Field label="Scope / notes" className="full"><textarea className="input" rows={3} value={f.description} onChange={set('description')} placeholder="What needs to be delivered"/></Field>
        <p className="small muted full">{website?'The head, selected developers and sales person share the project group. The CEO/admin can oversee every project.':'The social/content person is the client contact. The selected team gets the project group.'}</p>
      </div>}
    </form>
  </Modal>;
}
