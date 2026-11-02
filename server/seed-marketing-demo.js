// One-shot data seed; this does not start the API or frontend.
import { mkdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { migrate, seedBasics } from '../shared/setup.js';
import { seedMarketingDemo, MARKETING_DEMO_PEOPLE, marketingDemoEmail } from '../shared/marketing-demo.js';
import { importLegacyDailyRows } from '../shared/daily-reporting.js';
import { todayIn, isDate } from '../shared/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
const reset=process.argv.includes('--reset');
const dbFile=path.join(dataDir,'projects.db');
if(reset && existsSync(dbFile)){
  const backupDir=path.join(dataDir,'backups');
  mkdirSync(backupDir,{recursive:true});
  const backupFile=path.join(backupDir,'before-marketing-clean-'+Date.now()+'.db');
  const source=new DatabaseSync(dbFile);
  source.exec('PRAGMA busy_timeout=5000');
  try{source.exec("VACUUM INTO '"+backupFile.replaceAll("'","''")+"'");console.log('Backup: '+backupFile);}finally{source.close();}
}
const db = openDb(dbFile);
try {
  migrate(db); seedBasics(db);
  const seedDate = process.argv.find(arg => arg.startsWith('--date='))?.slice(7) || todayIn(process.env.TIMEZONE || 'Asia/Kolkata');
  if (!isDate(seedDate)) throw new Error('Use --date=YYYY-MM-DD for a valid sample work date');
  const result = await seedMarketingDemo(db, { today: seedDate, passwordHash: await hashPassword('demo1234'), reset });
  importLegacyDailyRows(db);
  console.log(result.added ? JSON.stringify(result) : 'Marketing demo data is already loaded; existing work was kept.');
  console.log('Sample account password: demo1234.');
  for (const p of MARKETING_DEMO_PEOPLE) console.log(marketingDemoEmail(p.key) + ' — ' + p.title);
} finally { db.close(); }
