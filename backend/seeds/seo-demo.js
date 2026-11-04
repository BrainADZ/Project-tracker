export const SEO_DEMO_PEOPLE = [
  {
    key: 'seo-manager',
    name: 'Aditi Mehra (Demo)',
    title: 'SEO Manager',
    level: 'member',
    color: '#0f766e',
  },
  {
    key: 'seo-executive',
    name: 'Riya Kapoor (Demo)',
    title: 'SEO Executive',
    level: 'member',
    color: '#2563eb',
  },
];

export const seoDemoEmail = (key) => key + '.demo@brainadz.com';
const SEED_KEY = 'seo_demo_v1';

// Additive and repeatable: never resets existing projects or passwords.
export function seedSeoDemo(db, { today, passwordHash, now = new Date().toISOString() }) {
  const saved = db.get('SELECT value FROM settings WHERE key=?', SEED_KEY);
  const vertical = db.get("SELECT id FROM verticals WHERE code='MKT' AND active=1");
  if (!vertical) throw new Error('An active Marketing vertical is required');
  if (saved) {
    const result = JSON.parse(saved.value);
    const manager = db.get('SELECT id FROM users WHERE email=?', seoDemoEmail('seo-manager'));
    if (
      manager?.id === result.accounts?.['seo-manager'] &&
      db.get('SELECT owner_id FROM projects WHERE id=?', result.project_id)?.owner_id === manager.id
    )
      db.run(
        "UPDATE user_verticals SET level='member' WHERE user_id=? AND vertical_id=? AND level='manager'",
        manager.id,
        vertical.id,
      );
    return { added: false, ...result };
  }
  return db.tx(() => {
    const people = {};
    for (const person of SEO_DEMO_PEOPLE) {
      const email = seoDemoEmail(person.key);
      const existing = db.get('SELECT id,active FROM users WHERE email=?', email);
      if (existing && !existing.active)
        throw new Error('The demo account ' + email + ' is inactive; existing settings were kept');
      people[person.key] =
        existing?.id ||
        db.run(
          "INSERT INTO users (name,email,password_hash,role,title,color,active,must_change_password,created_at) VALUES (?,?,?,'member',?,?,1,0,?)",
          person.name,
          email,
          passwordHash,
          person.title,
          person.color,
          now,
        ).id;
      db.run(
        'INSERT INTO user_verticals (user_id,vertical_id,level) VALUES (?,?,?) ON CONFLICT(user_id,vertical_id) DO UPDATE SET level=excluded.level',
        people[person.key],
        vertical.id,
        person.level,
      );
    }

    let number = 1;
    let code;
    do {
      code = 'MKT-' + today.slice(2, 4) + '-' + String(number++).padStart(3, '0');
    } while (db.get('SELECT id FROM projects WHERE code=?', code));
    const manager = people['seo-manager'];
    const executive = people['seo-executive'];
    const project = db.run(
      "INSERT INTO projects (code,vertical_id,name,client,description,status,health,priority,stages,stage,owner_id,start_date,tags,created_by,created_at,updated_at,service_type,service_details) VALUES (?,?,?,?,?,'active','on_track','medium','[]','',?,?,'demo,seo',?,?,?,'seo',?)",
      code,
      vertical.id,
      'GreenLeaf Foods — SEO (Demo)',
      'GreenLeaf Foods (Demo)',
      'Monthly SEO work, keyword rankings and organic search performance.',
      manager,
      today,
      manager,
      now,
      now,
      JSON.stringify({
        manager_id: manager,
        specialist_id: executive,
        website_url: 'greenleaf.example',
        keyword_count: 10,
        monthly_target: 8,
        deliverables: 'Technical audit, on-page improvements and keyword tracking',
      }),
    ).id;
    for (const userId of Object.values(people))
      db.run('INSERT INTO project_members (project_id,user_id) VALUES (?,?)', project, userId);
    const task = db.run(
      "INSERT INTO tasks (project_id,title,description,status,assignee_id,assigned_at,assigned_by,start_date,due_date,sort,created_by,created_at,updated_at) VALUES (?,?,?,'todo',?,?,?,?,?,1,?,?,?)",
      project,
      'Audit product page titles and meta descriptions',
      'Review priority pages and record recommended changes.',
      executive,
      now,
      manager,
      today,
      today,
      manager,
      now,
      now,
    ).id;
    db.run(
      "INSERT INTO daily_reporting (task_id,report_date,work_type,remarks,created_by,updated_at) VALUES (?,?,'On-page SEO',?,?,?)",
      task,
      today,
      'Start with the highest traffic product pages.',
      manager,
      now,
    );
    db.run(
      'INSERT INTO report_work (work_key,task_id,updated_at) VALUES (?,?,?)',
      'task-' + task,
      task,
      now,
    );
    const result = { project_id: project, people: 2, tasks: 1, accounts: people };
    db.run('INSERT INTO settings (key,value) VALUES (?,?)', SEED_KEY, JSON.stringify(result));
    return { added: true, ...result };
  });
}
