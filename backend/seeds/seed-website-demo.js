// One-shot additive demo seed. Does not start the frontend or API.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgres } from '../models/postgres.js';
import { hashPassword } from '../services/auth.js';
import { migrate, seedBasics } from '../schema/setup.js';
import { seedWebsiteDemo, WEBSITE_DEMO_PEOPLE, websiteDemoEmail } from './website-demo.js';
import { todayIn, isDate } from '../services/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const today =
  process.argv.find((a) => a.startsWith('--date='))?.slice(7) ||
  todayIn(process.env.TIMEZONE || 'Asia/Kolkata');
if (!isDate(today)) throw new Error('Use --date=YYYY-MM-DD for a valid sample date');
mkdirSync(dataDir, { recursive: true });
const db = openPostgres(process.env.DATABASE_URL);
try {
  migrate(db);
  seedBasics(db);
  const result = seedWebsiteDemo(db, {
    today,
    passwordHash: await hashPassword('demo1234'),
    now: new Date().toISOString(),
  });
  console.log(
    result.added
      ? 'Website demo added. Project id: ' + result.project_id
      : 'Website demo already exists; existing work was kept.',
  );
  console.log('New sample account password: demo1234');
  for (const person of WEBSITE_DEMO_PEOPLE)
    console.log(websiteDemoEmail(person.key) + ' — ' + person.title);
} finally {
  db.close();
}
