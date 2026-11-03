export const MARKETING_DEMO_PEOPLE = [
  { key:'manager',name:'Kavita Rao (Demo)',title:'Marketing Manager',level:'manager',color:'#1fb2d6' },
  { key:'priti',name:'Priti Shah (Demo)',title:'Social / Content · Client Contact',level:'member',color:'#e31b3b' },
  { key:'komal',name:'Komal Patel (Demo)',title:'Designer',level:'member',color:'#7c5cfc' },
  { key:'sales',name:'Rohit Verma (Demo)',title:'Sales',level:'member',color:'#b45309' },
];
export const marketingDemoEmail = key => key + '.demo@brainadz.com';
const SEED_KEY='marketing_clean_demo_v2';
const OLD_DEMO_EMAILS=[
  'kavita.rao@brainadz.com','nandini.joshi@brainadz.com','aarav.mehta@brainadz.com','siddharth.menon@brainadz.com','kavya.singh@brainadz.com',
  'priti.demo@brainadz.com','loveneet.demo@brainadz.com','nisha.demo@brainadz.com','komal.demo@brainadz.com','aashish.demo@brainadz.com','roshan.demo@brainadz.com',
  ...MARKETING_DEMO_PEOPLE.map(p=>marketingDemoEmail(p.key)),
];

// reset is explicit: other verticals and their people/work are retained.
export async function seedMarketingDemo(db,{today,passwordHash,reset=false}) {
  if(!reset && db.get('SELECT value FROM settings WHERE key=?',SEED_KEY))return {added:false,people:0,clients:0,jobs:0};
  const vertical=db.get("SELECT id FROM verticals WHERE code='MKT' AND active=1");
  if(!vertical)throw new Error('An active Marketing vertical is required');
  const now=today+'T04:00:00.000Z';
  return db.tx(()=>{
    let removedProjects=0;
    if(reset){
      const oldProjects=db.all('SELECT id FROM projects WHERE vertical_id=?',vertical.id);
      for(const p of oldProjects){
        for(const scope of ['group:'+p.id,'project:'+p.id+':tasks','project:'+p.id+':files','project:'+p.id+':discussion'])db.run('DELETE FROM seen WHERE scope=?',scope);
      }
      db.run('DELETE FROM extra_work WHERE vertical_id=?',vertical.id);
      removedProjects=db.run('DELETE FROM projects WHERE vertical_id=?',vertical.id).changes;
      db.run('DELETE FROM templates WHERE vertical_id=?',vertical.id);
      for(const email of new Set(OLD_DEMO_EMAILS)){
        const u=db.get("SELECT id,role FROM users WHERE email=?",email);
        if(!u || u.role==='admin')continue;
        db.run('DELETE FROM user_verticals WHERE user_id=? AND vertical_id=?',u.id,vertical.id);
        if(!db.get('SELECT 1 AS n FROM user_verticals WHERE user_id=?',u.id)){
          db.run('UPDATE users SET active=0 WHERE id=?',u.id);
          db.run('DELETE FROM sessions WHERE user_id=?',u.id);
          db.run('DELETE FROM notifications WHERE user_id=?',u.id);
          const keptEmails=new Set(MARKETING_DEMO_PEOPLE.map(p=>marketingDemoEmail(p.key)));
          if(!keptEmails.has(email)){
            const references=[['projects','owner_id'],['projects','created_by'],['tasks','assignee_id'],['tasks','created_by'],['tasks','assigned_by'],['project_members','user_id'],['comments','user_id'],['comments','delete_decided_by'],['group_messages','user_id'],['group_messages','delete_decided_by'],['activity','user_id'],['files','uploaded_by'],['extra_work','created_by'],['extra_work','assignee_id'],['report_work_sessions','user_id'],['report_work_notes','user_id']];
            const usedElsewhere=references.some(([table,column])=>db.get('SELECT 1 AS n FROM '+table+' WHERE '+column+'=? LIMIT 1',u.id));
            if(!usedElsewhere)db.run('DELETE FROM users WHERE id=?',u.id);
          }
        }
      }
      for(const key of ['marketing_demo_seed_v1','marketing_workflow_demo_v1',SEED_KEY])db.run('DELETE FROM settings WHERE key=?',key);
    }
    const ids={};
    for(const p of MARKETING_DEMO_PEOPLE){
      const email=marketingDemoEmail(p.key),existing=db.get('SELECT id FROM users WHERE email=?',email);
      if(existing){
        ids[p.key]=existing.id;
        if(reset)db.run('UPDATE users SET name=?,title=?,color=?,password_hash=?,active=1,must_change_password=0 WHERE id=?',p.name,p.title,p.color,passwordHash,existing.id);
      }else ids[p.key]=db.run("INSERT INTO users (name,email,password_hash,role,title,color,active,must_change_password,created_at) VALUES (?,?,?,'member',?,?,1,0,?)",p.name,email,passwordHash,p.title,p.color,now).id;
      db.run('INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?) ON CONFLICT(user_id,vertical_id) DO UPDATE SET level=excluded.level',ids[p.key],vertical.id,p.level);
    }
    const clients=['Northstar Pumps','GreenLeaf Foods','Horizon Retail','BlueWave Fitness'];
    for(const [index,name] of clients.entries()){
      const existing=db.get('SELECT id FROM projects WHERE vertical_id=? AND client=?',vertical.id,name+' (Demo)');
      if(existing)continue;
      let n=index+1,code;
      do{code='MKT-'+today.slice(2,4)+'-'+String(n++).padStart(3,'0');}while(db.get('SELECT id FROM projects WHERE code=?',code));
      const details={monthly_target:15,platforms:'Instagram, Facebook',lead_id:ids.priti,specialist_id:ids.komal,manager_id:ids.manager,sales_id:ids.sales};
      const {id}=db.run("INSERT INTO projects (code,vertical_id,name,client,description,status,health,priority,stages,stage,owner_id,start_date,created_by,created_at,updated_at,service_type,service_details) VALUES (?,?,?,?,?,'active','on_track','medium',?,?,?,?,?,?,?,'social',?)",code,vertical.id,name+' — Social media',name+' (Demo)','Demo client · 15 creatives per month.',JSON.stringify(['Plan','Work','Done']),'Plan',ids.manager,today,ids.manager,now,now,JSON.stringify(details));
      for(const userId of Object.values(ids))db.run('INSERT INTO project_members (project_id,user_id) VALUES (?,?)',id,userId);
      db.run("INSERT INTO group_messages (project_id,user_id,kind,body,created_at) VALUES (?,?,'system',?,?)",id,ids.manager,'Project group created.',now);
    }
    db.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',SEED_KEY,today);
    return {added:true,people:4,clients:4,jobs:0,...(reset?{removedProjects}:{})};
  });
}
