// One-shot additive demo seed. Does not start the frontend or API.
import { mkdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { migrate, seedBasics } from '../shared/setup.js';
import { seedWebsiteDemo, WEBSITE_DEMO_PEOPLE, websiteDemoEmail } from '../shared/website-demo.js';
import { todayIn, isDate } from '../shared/util.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(root,process.env.DATA_DIR||'data');
const today=process.argv.find(a=>a.startsWith('--date='))?.slice(7)||todayIn(process.env.TIMEZONE||'Asia/Kolkata');
if(!isDate(today))throw new Error('Use --date=YYYY-MM-DD for a valid sample date');
mkdirSync(dataDir,{recursive:true});
const file=path.join(dataDir,'projects.db');
if(existsSync(file)){
  const folder=path.join(dataDir,'backups');mkdirSync(folder,{recursive:true});
  const backup=path.join(folder,'before-website-demo-'+Date.now()+'.db');
  const source=new DatabaseSync(file);source.exec('PRAGMA busy_timeout=5000');
  try{source.exec("VACUUM INTO '"+backup.replaceAll("'","''")+"'");console.log('Backup: '+backup);}finally{source.close();}
}
const db=openDb(file);
try{
  migrate(db);seedBasics(db);
  const result=seedWebsiteDemo(db,{today,passwordHash:await hashPassword('demo1234'),now:new Date().toISOString()});
  console.log(result.added?'Website demo added. Project id: '+result.project_id:'Website demo already exists; existing work was kept.');
  console.log('New sample account password: demo1234');
  for(const person of WEBSITE_DEMO_PEOPLE)console.log(websiteDemoEmail(person.key)+' — '+person.title);
  if(db.get('PRAGMA foreign_key_check'))throw new Error('Database reference check failed');
}finally{db.close();}
