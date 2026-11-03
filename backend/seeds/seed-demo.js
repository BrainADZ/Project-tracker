// Loads the fictional demo team and projects into the server database.
// Every demo person signs in with the password "demo1234".
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgres } from '../models/postgres.js';
import { migrate, seedBasics } from '../schema/setup.js';
import { seedDemo, DEMO_PASSWORD, DEMO_ACCOUNTS, demoEmail } from './demo-seed.js';
import { hashPassword } from '../services/auth.js';
import { todayIn } from '../services/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
const db = openPostgres(process.env.DATABASE_URL);
migrate(db);
seedBasics(db);
const done = seedDemo(db, {
  today: todayIn(process.env.TIMEZONE || 'Asia/Kolkata'),
  passwordHash: await hashPassword(DEMO_PASSWORD),
});
if (!done) {
  console.log('The database already has projects, so demo data was not added.');
} else {
  console.log('Demo data added. Sign in with any of these (password: demo1234):');
  for (const a of DEMO_ACCOUNTS) console.log(`  ${demoEmail(a.key).padEnd(32)} ${a.label}`);
}
db.close();
