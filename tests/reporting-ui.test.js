
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function loadReportingComponents(){
 const result=await build({
  stdin:{contents:"export {GeneralDailyReporting as SocialReporting} from './client/src/pages/DailyReporting.jsx';export {default as DevelopmentReporting} from './client/src/pages/DevelopmentReporting.jsx';export {default as TaskReview} from './client/src/pages/WebsiteTaskReview.jsx';export {ProjectForm} from './client/src/pages/ProjectForm.jsx';export {MarketingProjectForm as ServiceForm} from './client/src/pages/MarketingProjectForm.jsx';export {default as ProjectProgress} from './client/src/pages/WebsiteProgress.jsx';",resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',
  plugins:[{name:'report-screen-fixture',setup(b){
   b.onResolve({filter:/\/(?:store\.jsx|router\.jsx|api\.js|ui\.jsx)$/},a=>{
    if(!a.importer.includes('client'))return;
    return {path:a.path.split('/').pop(),namespace:'report-fixture'};
   });
   b.onLoad({filter:/.*/,namespace:'report-fixture'},({path})=>({loader:'jsx',resolveDir:process.cwd(),contents:
    path==='store.jsx'?'export const useApp=()=>globalThis.__reportFixture.app; export const useLoad=fn=>({data:fn(),loading:false,reload(){}});':
    path==='api.js'?'export const api={get:(path,query)=>{globalThis.__reportFixture.requests.push({path,query});return path==="/projects"?globalThis.__reportFixture.projects:path==="/development-reporting/options"?{projects:[],can_add_extra:false}:path==="/development-reporting/pending"?{items:[]}:globalThis.__reportFixture.report;},post:async(path,body)=>{(globalThis.__reportFixture.posts||=[]).push({path,body});return {ok:true};},saveText:async(name,text)=>{globalThis.__reportFixture.exported={name,text};}};':
    path==='router.jsx'?'export const useRouter=()=>({navigate(){}});export const Link=({to,children,...p})=><a href={to} {...p}>{children}</a>;':
    'export const Modal=({title,children,footer})=><section><h2>{title}</h2>{children}{footer}</section>;export const Field=({label,children})=><div><label>{label}</label>{children}</div>;export const UserSelect=()=>null;export const Avatar=()=>null;export const Progress=({value})=><span>{value}%</span>;export const PROJECT_STATUS={active:{label:"Active"}};export const HEALTH={};export const PRIORITY={};export const Loading=()=>null;export const ErrorNote=()=>null;export const Empty=({title,children})=><div>{title}{children}</div>;'
   }));
  }}]
 });
 const mod={exports:{}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
 return mod.exports;
}

test('separate report screens render employee privacy controls and export only the selected sheet',async()=>{
 const loaded=await loadReportingComponents();
 const components={social:loaded.SocialReporting,development:loaded.DevelopmentReporting};
 let tree;
 const Capture=props=>{tree=components[props.department](props);return tree;};
 const walk=(node,predicate)=>{
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const found=walk(child,predicate);if(found)return found;}
  return null;
 };
 try{
  for(const department of ['social','development'])for(const manager of [false,true]){
   const row={id:'extra-1',parent_task_id:11,parent_task_title:'UI design',work_key:'extra-1',project_id:1,client:'Only this client',project_name:'Only this project',service_type:department==='social'?'social':'website',title:'Visible work',report_date:'2026-10-31',work_type:'Design',stage:'Design',social_name:'Content employee',designer_name:'Assigned employee',social_id:7,assignee_id:8,status:'Not Started',total_ms:0,period_ms:0,can_timer:!manager,note_count:0};
   globalThis.__reportFixture={
    app:{today:'2026-10-31',me:{id:8,title:department==='social'?'Designer':'Developer',role:'member',access:{1:manager?'manager':'member'}},users:[{id:7,name:'Content employee'},{id:8,name:'Assigned employee'}],verticals:[],toast(){},bumpCounts(){},refresh(){},reportingDepartment:department},
    projects:{items:[]},report:{items:[row],can_view_team:manager,member_ids:[7,8],can_add:true,department,server_now:'2026-10-31T06:00:00Z'},requests:[],
   };
   const html=renderToStaticMarkup(React.createElement(Capture,{department}));
   assert.ok(html.includes(department==='social'?'Social Media Reporting':'Development Reporting'));
   assert.equal(html.includes('aria-label="Filter team member"'),manager);
   assert.equal(html.includes('All team members'),manager);
   assert.equal(html.includes('Show all'),false);
   assert.equal(html.includes('<th scope="col">Social / content</th>'),department==='social');
   assert.equal(html.includes('<th>Developer</th>'),department==='development'&&manager);
   assert.equal(html.includes('<th>Main task</th>'),department==='development');
   assert.equal(html.includes('<th scope="col">Deadline</th>'),false);
   assert.equal(html.includes('All project tasks'),false);
   const request=globalThis.__reportFixture.requests.find(r=>r.path==='/daily-reporting');
   assert.equal(request.query.department,department);
   const button=walk(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Export'));
   assert.ok(button);button.props.onClick();
   const exported=globalThis.__reportFixture.exported;
   assert.equal(exported.name,department+'-reporting-2026-10-31.csv');
   assert.equal(exported.text.split('\r\n').length,2);
   assert.ok(exported.text.includes('Visible work'));
   assert.equal(exported.text.includes('"Content person"'),department==='social');
   assert.equal(exported.text.includes('"Developer"'),department==='development');
  }
 }finally{delete globalThis.__reportFixture;}
});


test('task review controls show developer submission, head decisions and feedback',async()=>{
 const {TaskReview}=await loadReportingComponents();
 let tree,changed=0;
 const Capture=({task})=>{tree=TaskReview({task,onChanged:()=>changed++});return tree;};
 const buttons=node=>{
  if(!node||typeof node!=='object')return [];
  return [...(node.type==='button'?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(buttons)];
 };
 const title=node=>React.Children.toArray(node.props.children).filter(x=>typeof x==='string').join('');
 try{
  globalThis.__reportFixture={app:{toast(){},bumpCounts(){}},posts:[]};
  let task={id:42,title:'UI design',status:'in_progress',review:{latest:null,is_assignee:true,can_submit:true,can_review:false}};
  let html=renderToStaticMarkup(React.createElement(Capture,{task}));
  assert.ok(html.includes('Submit task for review'));assert.equal(html.includes('Changes required'),false);
  const submit=buttons(tree).find(b=>title(b)==='Submit task for review');
  assert.equal(submit.props.disabled,false);
  const pending={id:11,status:'pending',note:'Tested desktop and mobile',preview_url:'https://preview.example',submitted_by_name:'Developer',submitted_at:'2026-10-31T06:00:00Z'};
  task={...task,status:'review',review:{latest:pending,is_assignee:true,can_submit:false,can_review:false}};
  html=renderToStaticMarkup(React.createElement(Capture,{task}));
  assert.ok(html.includes('Waiting for head'));assert.equal(buttons(tree).some(b=>title(b)==='Approve'),false);
  task={...task,review:{...task.review,is_assignee:false,can_review:true}};
  html=renderToStaticMarkup(React.createElement(Capture,{task}));
  assert.ok(html.includes('Tested desktop and mobile'));assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(buttons(tree).some(b=>title(b)==='Changes required'));
  await buttons(tree).find(b=>title(b)==='Approve').props.onClick();
  assert.deepEqual(globalThis.__reportFixture.posts,[{path:'/tasks/42/review',body:{review_id:11,decision:'approve'}}]);
  assert.equal(changed,1);
  task={...task,status:'in_progress',review:{latest:{...pending,status:'changes_required',feedback:'Fix mobile layout'},is_assignee:true,can_submit:false,can_review:false,blocker:'Complete your 1 current module before submitting.'}};
  html=renderToStaticMarkup(React.createElement(Capture,{task}));
  assert.ok(html.includes('Fix mobile layout'));
  assert.ok(html.includes('Complete your 1 current module'));
  assert.equal(buttons(tree).find(b=>title(b)==='Submit task for review').props.disabled,true);
 }finally{delete globalThis.__reportFixture;}
});


test('Live project picker and software form use development roles and submit only software details',async()=>{
 const {ProjectForm,ServiceForm,ProjectProgress}=await loadReportingComponents();
 const verticals=[{id:1,code:'LIV',name:'BrainADZ Live',short:'Live'},{id:2,code:'MKT',name:'BrainADZ Marketing',short:'Marketing'}];
 const users=[{id:10,name:'Software Head',title:'Software Head'},{id:11,name:'Developer One',title:'Developer'},{id:12,name:'Developer Two',title:'Developer'},{id:13,name:'Sales Person',title:'Sales'}];
 const software={id:3,vertical_id:1,service_type:'software',name:'Client operations',client:'Client',status:'active',owner_id:10,members:users,service_details:{head_id:10,developer_ids:[11,12],sales_id:13,application_type:'Web app',technology:'React + Node.js'}};
 let tree,saved=false;
 const Capture=()=>{tree=ServiceForm({copyFrom:software,initialService:'software',serviceChoices:{software:'Software development'},verticalId:1,onSaved:()=>{saved=true;}});return tree;};
 const walk=(node,predicate)=>{
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const found=walk(child,predicate);if(found)return found;}
  return null;
 };
 try{
  globalThis.__reportFixture={app:{today:'2026-10-31',me:{id:10,role:'member'},manageableVerticals:verticals,verticals,vertical:1,assignable:()=>users,toast(){}},posts:[]};
  let html=renderToStaticMarkup(React.createElement(ProjectForm,{initialVertical:1,onClose(){}}));
  assert.ok(html.includes('Live / event'));assert.ok(html.includes('Software development'));
  assert.equal(html.includes('Social media'),false);
  html=renderToStaticMarkup(React.createElement(ProjectForm,{project:software}));
  for(const label of ['Software head','Developers · 2 selected','Sales person (whose client)','Application type','Technology'])assert.ok(html.includes(label),label);
  for(const label of ['Website / domain','Number of pages','Social / content person','Marketing manager'])assert.equal(html.includes(label),false,label);
  html=renderToStaticMarkup(React.createElement(ProjectForm,{initialVertical:2}));
  assert.ok(html.includes('Social media'));assert.ok(html.includes('Website'));assert.equal(html.includes('Software development'),false);
  renderToStaticMarkup(React.createElement(Capture));
  await walk(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(saved,true);
  const post=globalThis.__reportFixture.posts[0];
  assert.equal(post.path,'/projects');assert.equal(post.body.vertical_id,1);assert.equal(post.body.service_type,'software');
  assert.deepEqual(post.body.service_details,{head_id:10,developer_ids:[11,12],sales_id:13,application_type:'Web app',technology:'React + Node.js'});
  assert.deepEqual(post.body.member_ids,[10,11,12,13]);
  const summary={done:1,total:2,percent:50,current_phase:'Development',phases:[{name:'Design',total:1,done:1},{name:'Development',total:1,done:0}],running:1,paused:0,ready_for_review:0,changes_requested:0,overdue:0};
  html=renderToStaticMarkup(React.createElement(ProjectProgress,{summary,software:true}));
  assert.ok(html.includes('Software progress'));assert.ok(html.includes('1 / 2 tasks done'));assert.equal(html.includes('Website'),false);
 }finally{delete globalThis.__reportFixture;}
});
