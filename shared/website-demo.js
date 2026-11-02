import { addDays } from './util.js';
import { WEBSITE_STAGES } from './project-services.js';
import { initWebsiteDailyRows } from './work-tracking.js';

export const WEBSITE_DEMO_PEOPLE = [
  {key:'web-head',name:'Arjun Mehta (Demo)',title:'Website Head',color:'#2563eb'},
  {key:'web-dev1',name:'Neha Sharma (Demo)',title:'Frontend Developer',color:'#7c5cfc'},
  {key:'web-dev2',name:'Aman Gupta (Demo)',title:'Backend Developer',color:'#0f766e'},
  {key:'web-sales',name:'Vivek Singh (Demo)',title:'Website Sales',color:'#b45309'},
];
export const websiteDemoEmail=key=>key+'.demo@brainadz.com';
const SEED_KEY='website_demo_v1';

// Additive and idempotent: never resets another client, existing passwords or edited sample work.
export function seedWebsiteDemo(db,{today,passwordHash,now=new Date().toISOString()}) {
  const saved=db.get('SELECT value FROM settings WHERE key=?',SEED_KEY);
  if(saved)return {added:false,...JSON.parse(saved.value)};
  const vertical=db.get("SELECT id FROM verticals WHERE code='MKT' AND active=1");
  if(!vertical)throw new Error('An active Marketing vertical is required');
  return db.tx(()=>{
    const people={};
    for(const person of WEBSITE_DEMO_PEOPLE){
      const email=websiteDemoEmail(person.key),existing=db.get('SELECT id,active FROM users WHERE email=?',email);
      if(existing&&!existing.active)throw new Error('The demo account '+email+' is inactive; existing account settings were kept');
      people[person.key]=existing?.id||db.run("INSERT INTO users (name,email,password_hash,role,title,color,active,must_change_password,created_at) VALUES (?,?,?,'member',?,?,1,0,?)",person.name,email,passwordHash,person.title,person.color,now).id;
      db.run("INSERT OR IGNORE INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,'member')",people[person.key],vertical.id);
    }
    const head=people['web-head'],dev1=people['web-dev1'],dev2=people['web-dev2'],sales=people['web-sales'];
    let n=1,code;
    do{code='MKT-'+today.slice(2,4)+'-'+String(n++).padStart(3,'0');}while(db.get('SELECT id FROM projects WHERE code=?',code));
    const details={head_id:head,developer_ids:[dev1,dev2],sales_id:sales,website_url:'novacommerce.example',page_count:8,technology:'WordPress + WooCommerce'};
    const project=db.run("INSERT INTO projects (code,vertical_id,name,client,description,status,health,priority,stages,stage,owner_id,start_date,due_date,tags,created_by,created_at,updated_at,service_type,service_details) VALUES (?,?,?,?,?,'active','on_track','medium',?,?,?,?,?,'demo,website',?,?,?,'website',?)",
      code,vertical.id,'Nova Commerce — Website (Demo)','Nova Commerce (Demo)','Build an 8-page store: homepage, catalogue, product detail, cart, checkout, about, contact and policies. Responsive design and payment testing before launch.',JSON.stringify(WEBSITE_STAGES),'Development',head,addDays(today,-3),addDays(today,7),head,now,now,JSON.stringify(details)).id;
    for(const id of Object.values(people))db.run('INSERT INTO project_members (project_id,user_id) VALUES (?,?)',project,id);
    const plans=[
      {title:'Homepage wireframe and layout',phase:'Design',assignee:dev1,offset:-2,due:-1,state:'Done',minutes:45,daysAgo:2,note:'Homepage layout approved by the head.'},
      {title:'Mobile design and product page UI',phase:'Design',assignee:dev2,offset:0,due:0,state:'Done',minutes:60,note:'Responsive UI completed and ready for development.'},
      {title:'Homepage development and product sections',phase:'Development',assignee:dev1,offset:0,due:2,state:'Paused',minutes:30,note:'Waiting for product images from the client. Resume after the assets arrive.'},
      {title:'Cart, checkout and payment integration',phase:'Development',assignee:dev2,offset:0,due:3,state:'Not Started',note:'Build checkout and test the payment gateway in sandbox mode.'},
      {title:'Mobile, browser and checkout testing',phase:'Testing',assignee:dev2,offset:2,due:5,state:'Not Started',note:'Check forms, payments, mobile layouts and major browsers.'},
      {title:'Launch checklist and client handover',phase:'Launch',assignee:dev1,offset:4,due:7,state:'Not Started',note:'Back up the site, confirm launch approval and share the handover guide.'},
    ];
    const taskIds=[];
    for(const [i,plan] of plans.entries()){
      const status=plan.state==='Done'?'done':plan.state==='Paused'?'in_progress':'todo';
      const task=db.run('INSERT INTO tasks (project_id,title,description,status,priority,assignee_id,assigned_at,assigned_by,stage,start_date,due_date,checklist,sort,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        project,plan.title,plan.note,status,'medium',plan.assignee,now,head,plan.phase,addDays(today,plan.offset),addDays(today,plan.due),'[]',i+1,head,now,now).id;
      taskIds.push(task);
    }
    initWebsiteDailyRows(db,now,project);
    const base=Date.parse(now);
    for(const [i,plan] of plans.entries()){
      const task=taskIds[i],key='task-'+task;
      if(plan.minutes){
        const end=new Date(base-(plan.daysAgo||0)*86400000-(i===1?60:15)*60000).toISOString();
        const start=new Date(Date.parse(end)-plan.minutes*60000).toISOString();
        db.run('INSERT INTO report_work_sessions (work_key,user_id,started_at,ended_at,duration_ms) VALUES (?,?,?,?,?)',key,plan.assignee,start,end,plan.minutes*60000);
        db.run('UPDATE report_work SET state=?,first_started_at=?,completed_at=?,updated_at=? WHERE work_key=?',plan.state,start,plan.state==='Done'?end:null,now,key);
        if(plan.state==='Done')db.run('UPDATE tasks SET completed_at=? WHERE id=?',end,task);
      }
      if(plan.offset<=0)db.run('INSERT INTO report_work_notes (work_key,user_id,kind,note,created_at) VALUES (?,?,?,?,?)',key,plan.state==='Paused'?plan.assignee:head,'note',plan.note,new Date(base+Math.min(0,plan.offset)*86400000).toISOString());
    }
    db.run("INSERT INTO group_messages (project_id,user_id,kind,body,created_at) VALUES (?,?,'message',?,?)",project,head,'Designs approved. Neha owns the homepage; Aman owns checkout. Add progress and blockers against your tasks.',now);
    db.run("INSERT INTO group_messages (project_id,user_id,kind,body,created_at) VALUES (?,?,'message',?,?)",project,sales,'Client confirmed the 8-page scope. Product images are awaited; I will follow up.',now);
    db.run("INSERT INTO activity (project_id,user_id,action,detail,created_at) VALUES (?,?,'created',?,?)",project,head,'Website demo with two developers and six connected tasks',now);
    const result={project_id:project,people:4,tasks:taskIds.length,accounts:people};
    db.run('INSERT INTO settings (key,value) VALUES (?,?)',SEED_KEY,JSON.stringify(result));
    return {added:true,...result};
  });
}
