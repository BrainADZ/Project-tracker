// One-shot data seed; this does not start the API or frontend.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgres } from '../models/postgres.js';
import { hashPassword } from '../services/auth.js';
import { migrate, seedBasics } from '../schema/setup.js';
import { seedMarketingDemo, MARKETING_DEMO_PEOPLE, marketingDemoEmail } from './marketing-demo.js';
import { importLegacyDailyRows } from '../controllers/daily-reporting.js';
import { todayIn, isDate } from '../services/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
const reset = process.argv.includes('--reset');
const db = openPostgres(process.env.DATABASE_URL);
try {
  migrate(db);
  seedBasics(db);
  const seedDate =
    process.argv.find((arg) => arg.startsWith('--date='))?.slice(7) ||
    todayIn(process.env.TIMEZONE || 'Asia/Kolkata');
  if (!isDate(seedDate)) throw new Error('Use --date=YYYY-MM-DD for a valid sample work date');
  const result = await seedMarketingDemo(db, {
    today: seedDate,
    passwordHash: await hashPassword('demo1234'),
    reset,
  });
  if (db.kind !== 'postgres') importLegacyDailyRows(db);
  console.log(
    result.added
      ? JSON.stringify(result)
      : 'Marketing demo data is already loaded; existing work was kept.',
  );
  console.log('Sample account password: demo1234.');
  for (const p of MARKETING_DEMO_PEOPLE) console.log(marketingDemoEmail(p.key) + ' — ' + p.title);
} finally {
  db.close();
}
