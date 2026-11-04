import { parseJSON, placeholders } from './util.js';
import { atLeast, canManageVertical, visibleVerticalIds, canView } from '../models/access.js';
import {
  isDevelopmentProject,
  canChooseWorkContact,
  websiteDevelopers,
} from './project-services.js';

export const REPORTING_DEPARTMENTS = {
  social: 'Social Media Reporting',
  development: 'Development Reporting',
  seo: 'SEO Reporting',
  other: 'Project Reporting',
};
export function defaultReportingDepartment(user) {
  const title = user?.title || '';
  if (/\bseo\b/i.test(title)) return 'seo';
  return /\b(developer|development|frontend|backend|full.?stack|software|engineer(?:ing)?|website|web head|technical head)\b/i.test(
    title,
  )
    ? 'development'
    : 'social';
}
export function projectReportingDepartment(project) {
  return isDevelopmentProject(project)
    ? 'development'
    : project?.service_type === 'social'
      ? 'social'
      : project?.service_type === 'seo'
        ? 'seo'
        : 'other';
}
export const reportingPath = (department) =>
  '/daily-reporting/' + (REPORTING_DEPARTMENTS[department] ? department : 'social');
export function rowReportingDepartment(row) {
  return row.project_id ? projectReportingDepartment(row) : row.reporting_team || 'social';
}
export function canManageReport(user, row) {
  return (
    canChooseWorkContact(user, row) ||
    (row.owner_id === user?.id && atLeast(user, row.vertical_id, 'member'))
  );
}
export function canReadWork(user, row) {
  return (
    !!row &&
    atLeast(user, row.vertical_id, 'viewer') &&
    (!row.project_id || canView(user, { ...row, id: row.project_id })) &&
    (canManageReport(user, row) || row.assignee_id === user.id || row.social_id === user.id)
  );
}
export function reportingAccess(db, user) {
  const vids = visibleVerticalIds(user),
    departments = new Set();
  const preferred = defaultReportingDepartment(user);
  if (vids.some((id) => canManageVertical(user, id))) {
    departments.add('social');
    departments.add('development');
    departments.add('seo');
  }
  const projects = vids.length
    ? db.all(
        'SELECT id,vertical_id,service_type,service_details,owner_id FROM projects WHERE vertical_id IN (' +
          placeholders(vids) +
          ')',
        ...vids,
      )
    : [];
  for (const p of projects) {
    const details = parseJSON(p.service_details, {});
    const worker = isDevelopmentProject(p)
      ? websiteDevelopers(p).includes(user.id)
      : [details.lead_id, details.specialist_id].includes(user.id);
    if (worker || canManageReport(user, p)) departments.add(projectReportingDepartment(p));
  }
  if (vids.length) {
    for (const r of db.all(
      'SELECT DISTINCT p.service_type FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN daily_reporting d ON d.task_id=t.id WHERE p.vertical_id IN (' +
        placeholders(vids) +
        ') AND (t.assignee_id=? OR d.social_id=?)',
      ...vids,
      user.id,
      user.id,
    ))
      departments.add(projectReportingDepartment(r));
    for (const r of db.all(
      'SELECT DISTINCT reporting_team FROM extra_work WHERE assignee_id=? AND vertical_id IN (' +
        placeholders(vids) +
        ')',
      user.id,
      ...vids,
    ))
      departments.add(r.reporting_team);
    if (!departments.size) departments.add(preferred);
  }
  const ordered = ['social', 'development', 'seo', 'other'].filter((d) => departments.has(d));
  return {
    departments: ordered,
    default_department: departments.has(preferred) ? preferred : ordered[0] || preferred,
  };
}
