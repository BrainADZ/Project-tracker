import { bad, text, optDate, parseJSON } from './util.js';

// Store these once: changing a display name or vertical must not change a login.
export function ensureUserIdentity(db, id) {
  const user = db.get('SELECT id,name,username,employee_code FROM users WHERE id=?', id);
  if (!user) return {};
  if (user.username && user.employee_code) return user;
  const vertical = db.get(
    'SELECT v.code FROM user_verticals a JOIN verticals v ON v.id=a.vertical_id WHERE a.user_id=? ORDER BY v.sort,v.id LIMIT 1',
    id,
  );
  const prefix = { LIV: 'BZL', MKT: 'BZM', EXH: 'BZE' }[vertical?.code] || 'BZ';
  const number = String(id).padStart(3, '0');
  const code = user.employee_code || 'BZ' + number;
  const first =
    (user.name.trim().split(/\s+/)[0] || 'Employee').replace(/[^a-zA-Z0-9]/g, '') || 'Employee';
  let username = user.username || first + prefix + number;
  if (db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?', username, id))
    username += 'U' + id;
  db.run('UPDATE users SET username=?,employee_code=? WHERE id=?', username, code, id);
  return { ...user, username, employee_code: code };
}

export function profileFor(user) {
  const legacy = parseJSON(user?.profile_data, {}) || {};
  const allowed = [
    'about',
    'address',
    'emergency_contact',
    'skills',
    'dob',
    'department',
    'employment_type',
    'work_place',
    'location',
    'join_date',
    'manager_id',
    'certifications',
  ];
  const profile = Object.fromEntries(
    allowed.filter((key) => legacy[key] !== undefined).map((key) => [key, legacy[key]]),
  );
  for (const [oldKey, key] of Object.entries({
    reporting_manager_id: 'manager_id',
    working_place: 'work_place',
    assigned_branch: 'location',
    joining_date: 'join_date',
  })) {
    if (legacy[oldKey] !== undefined)
      profile[key] = key === 'manager_id' ? Number(legacy[oldKey]) || null : legacy[oldKey];
  }
  if (user?.photo) profile.photo = user.photo;
  const canonical = parseJSON(user?.profile_json, {}) || {};
  return {
    ...profile,
    ...Object.fromEntries(
      [...allowed, 'photo']
        .filter((key) => canonical[key] !== undefined)
        .map((key) => [key, canonical[key]]),
    ),
  };
}

export function readProfile(body, user) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Invalid profile');
  const result = {};
  if (
    Object.keys(body).some(
      (key) =>
        ![
          'about',
          'address',
          'dob',
          'emergency_contact',
          'skills',
          'certifications',
          'photo',
          'department',
          'employment_type',
          'work_place',
          'location',
          'join_date',
          'manager_id',
        ].includes(key),
    )
  )
    throw bad('Unsupported profile field');
  for (const key of [
    'about',
    'address',
    'emergency_contact',
    'skills',
    'department',
    'employment_type',
    'work_place',
    'location',
  ]) {
    if (body[key] !== undefined)
      result[key] =
        text(body[key], {
          max: key === 'about' ? 4000 : 1000,
          label: key.replaceAll('_', ' '),
        }) || '';
  }
  for (const key of ['dob', 'join_date'])
    if (body[key] !== undefined)
      result[key] = optDate(body[key], key === 'dob' ? 'Date of birth' : 'Joining date');
  if (body.manager_id !== undefined) {
    if (body.manager_id === null || body.manager_id === '') result.manager_id = null;
    else if (!Number.isSafeInteger(Number(body.manager_id)) || Number(body.manager_id) < 1)
      throw bad('Choose a valid reporting manager');
    else result.manager_id = Number(body.manager_id);
  }
  if (body.certifications !== undefined) {
    if (!Array.isArray(body.certifications) || body.certifications.length > 30)
      throw bad('Use up to 30 certifications');
    if (body.certifications.some((c) => !c || typeof c !== 'object' || Array.isArray(c)))
      throw bad('Enter valid certification details');
    result.certifications = body.certifications.map((c) => ({
      name: text(c.name, { max: 200, required: true, label: 'Certification' }),
      issuer: text(c.issuer, { max: 200, label: 'Issuer' }) || '',
      issued: optDate(c.issued, 'Issue date') || null,
    }));
  }
  if (body.photo !== undefined) {
    if (
      typeof body.photo !== 'string' ||
      body.photo.length > 1400000 ||
      (body.photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(body.photo))
    )
      throw bad('Choose a PNG, JPEG or WebP photo under 1 MB');
    result.photo = body.photo;
  }
  return result;
}
