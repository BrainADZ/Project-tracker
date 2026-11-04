// One-shot additive SEO demo seed; does not start the API or client.
import { openPostgres } from '../models/postgres.js';
import { hashPassword } from '../services/auth.js';
import { migrate, seedBasics } from '../schema/setup.js';
import { seedSeoDemo, SEO_DEMO_PEOPLE, seoDemoEmail } from './seo-demo.js';
import { todayIn, isDate } from '../services/util.js';

const today =
  process.argv.find((arg) => arg.startsWith('--date='))?.slice(7) ||
  todayIn(process.env.TIMEZONE || 'Asia/Kolkata');
if (!isDate(today)) throw new Error('Use --date=YYYY-MM-DD for a valid sample date');
const db = openPostgres(process.env.DATABASE_URL);
try {
  migrate(db);
  seedBasics(db);
  const result = seedSeoDemo(db, { today, passwordHash: await hashPassword('demo1234') });
  console.log(
    result.added
      ? 'SEO demo added. Project id: ' + result.project_id
      : 'SEO demo already exists; existing work was kept.',
  );
  console.log('Sample account password: demo1234');
  for (const person of SEO_DEMO_PEOPLE)
    console.log(seoDemoEmail(person.key) + ' — ' + person.title);
} finally {
  db.close();
}
