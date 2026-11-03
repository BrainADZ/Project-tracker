// Project access requires vertical access and a project assignment.
// Vertical managers and administrators can oversee their full scope.

export const LEVELS = ['viewer', 'member', 'manager'];
const RANK = { viewer: 1, member: 2, manager: 3 };

export function loadUser(db, id) {
  const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', id);
  if (!user) return null;
  const access = new Map();
  if (user.role === 'admin') {
    for (const v of db.all('SELECT id FROM verticals WHERE active = 1')) access.set(v.id, 'manager');
  } else {
    for (const row of db.all(
      'SELECT uv.vertical_id, uv.level FROM user_verticals uv JOIN verticals v ON v.id = uv.vertical_id WHERE uv.user_id = ? AND v.active = 1',
      id,
    )) {
      access.set(row.vertical_id, row.level);
    }
  }
  user.access = access;
  user.projectIds = new Set(db.all('SELECT p.id FROM projects p WHERE '+projectVisibilitySql(user)).map(p=>p.id));
  return user;
}

export const isAdmin = (user) => user?.role === 'admin';

export function levelFor(user, verticalId) {
  return user?.access?.get(Number(verticalId)) || null;
}

export function atLeast(user, verticalId, level) {
  const have = levelFor(user, verticalId);
  return !!have && RANK[have] >= RANK[level];
}

export function visibleVerticalIds(user) {
  return [...(user?.access?.keys() || [])];
}

export const canView = (user, project) => !!project && levelFor(user, project.vertical_id) !== null &&
  (canManageVertical(user,project.vertical_id)||project.owner_id===user.id||user.projectIds?.has(project.id));

export const canManageVertical = (user, verticalId) => isAdmin(user) || atLeast(user, verticalId, 'manager');

// Managers of the vertical, or the project's owner (if they still work in that vertical).
export const canEditProject = (user, project) =>
  canManageVertical(user, project.vertical_id) ||
  (project.owner_id === user.id && atLeast(user, project.vertical_id, 'member'));

// Tasks, files, milestones and comments.
export const canContribute = (user, project) => isAdmin(user) || atLeast(user, project.vertical_id, 'member');

export function permissionsFor(user, project) {
  return {
    view: canView(user, project),
    edit: canEditProject(user, project),
    contribute: canContribute(user, project),
    manage: canManageVertical(user, project.vertical_id),
    delete: isAdmin(user),
  };
}

/**
 * One project scope for list queries and direct reads. IDs come from the signed-in
 * database user; request filters can only narrow this scope.
 */
export function projectVisibilitySql(user, alias = 'p') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid project alias');
  const ids = visibleVerticalIds(user).filter(Number.isSafeInteger);
  const id = Number(user?.id);
  if (!ids.length || !Number.isSafeInteger(id) || id < 1) return '0';
  const vertical = alias+'.vertical_id IN ('+ids.join(',')+')';
  if (isAdmin(user)) return '('+vertical+')';
  const managed = ids.filter(v=>canManageVertical(user,v));
  const scope = [
    ...(managed.length ? [alias+'.vertical_id IN ('+managed.join(',')+')'] : []),
    alias+'.owner_id = '+id,
    'EXISTS (SELECT 1 FROM project_members visibility_member WHERE visibility_member.project_id = '+alias+'.id AND visibility_member.user_id = '+id+')',
    'EXISTS (SELECT 1 FROM tasks visibility_task WHERE visibility_task.project_id = '+alias+'.id AND visibility_task.assignee_id = '+id+')',
    'EXISTS (SELECT 1 FROM daily_reporting visibility_report JOIN tasks visibility_work ON visibility_work.id = visibility_report.task_id WHERE visibility_work.project_id = '+alias+'.id AND visibility_report.social_id = '+id+')',
  ];
  return '('+vertical+' AND ('+scope.join(' OR ')+'))';
}
