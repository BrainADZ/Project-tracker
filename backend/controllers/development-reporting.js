import { websiteTaskReview } from './website-task-review.js';
import { bad, forbidden, notFound, toId, text, optDate } from '../services/util.js';
import { canView, atLeast, projectVisibilitySql } from '../models/access.js';
import {
  isDevelopmentProject,
  canChooseWorkContact,
  websiteDevelopers,
} from '../services/project-services.js';
import { addWorkNote } from '../services/work-tracking.js';

function openProject(ctx, id) {
  const p = ctx.db.get(
    "SELECT * FROM projects WHERE id=? AND service_type IN ('website','software')",
    toId(id, 'Development project'),
  );
  if (!canView(ctx.user, p)) throw notFound('Project');
  if (!atLeast(ctx.user, p.vertical_id, 'member')) throw forbidden('You have view-only access');
  if (['completed', 'cancelled'].includes(p.status))
    throw bad('Reopen the project before adding daily work');
  return p;
}
export function registerDevelopmentReporting(route, call) {
  route('GET', '/development-reporting/options', (ctx) => {
    const projects = ctx.db.all(
      "SELECT p.* FROM projects p WHERE p.service_type IN ('website','software') AND p.status NOT IN ('completed','cancelled') AND " +
        projectVisibilitySql(ctx.user) +
        ' ORDER BY p.name',
    );
    return {
      projects: projects.map((p) => {
        const mine = websiteDevelopers(p).includes(ctx.user.id)
          ? ctx.db.all(
              'SELECT * FROM tasks WHERE project_id=? AND assignee_id=? ORDER BY sort,id',
              p.id,
              ctx.user.id,
            )
          : [];
        return {
          id: p.id,
          name: p.name,
          client: p.client,
          can_manage: canChooseWorkContact(ctx.user, p),
          tasks: mine
            .filter((t) => !['done', 'review'].includes(t.status))
            .map((t) => ({
              id: t.id,
              title: t.title,
              stage: t.stage,
              due_date: t.due_date,
              status: t.status,
            })),
          review_tasks: mine
            .filter((t) => t.status !== 'done')
            .map((t) => ({ ...t, project_name: p.name, review: websiteTaskReview(ctx, t, p) })),
        };
      }),
      can_add_extra: projects.some((p) => websiteDevelopers(p).includes(ctx.user.id)),
    };
  });

  route('GET', '/development-reporting/pending', (ctx) => {
    const own = ctx.user.id;
    const extra = ctx.db.all(
      "SELECT 'extra-'||e.id id,e.title,e.report_date,e.parent_task_id,t.title parent_task_title,p.id project_id,p.name project_name,w.state status FROM extra_work e JOIN tasks t ON t.id=e.parent_task_id JOIN projects p ON p.id=t.project_id JOIN report_work w ON w.extra_id=e.id WHERE e.assignee_id=? AND t.assignee_id=? AND e.report_date<? AND t.status!='done' AND p.status NOT IN ('completed','cancelled') AND (w.state IN ('Under process','Paused','Not Started') OR w.state='Done' AND w.revision_pending=1) AND NOT EXISTS (SELECT 1 FROM extra_work n WHERE n.continued_from_key='extra-'||e.id) AND " +
        projectVisibilitySql(ctx.user),
      own,
      own,
      ctx.today,
    );
    const legacy = ctx.db.all(
      "SELECT t.id,t.title,d.report_date,t.id parent_task_id,t.title parent_task_title,p.id project_id,p.name project_name,w.state status FROM tasks t JOIN projects p ON p.id=t.project_id JOIN daily_reporting d ON d.task_id=t.id JOIN report_work w ON w.task_id=t.id WHERE p.service_type IN ('website','software') AND t.assignee_id=? AND d.report_date<? AND t.status!='done' AND p.status NOT IN ('completed','cancelled') AND w.state IN ('Under process','Paused','Not Started') AND EXISTS (SELECT 1 FROM report_work_sessions s WHERE s.work_key=w.work_key) AND NOT EXISTS (SELECT 1 FROM extra_work n WHERE n.continued_from_key=CAST(t.id AS TEXT)) AND " +
        projectVisibilitySql(ctx.user),
      own,
      ctx.today,
    );
    const standalone = ctx.db
      .all(
        "SELECT 'extra-'||e.id id,e.title,e.report_date,NULL AS parent_task_id,'Extra work' parent_task_title,NULL AS project_id,'Extra work' project_name,e.vertical_id,w.state status FROM extra_work e JOIN report_work w ON w.extra_id=e.id WHERE e.parent_task_id IS NULL AND e.reporting_team='development' AND e.assignee_id=? AND e.report_date<? AND (w.state IN ('Under process','Paused','Not Started') OR w.state='Done' AND w.revision_pending=1) AND NOT EXISTS (SELECT 1 FROM extra_work n WHERE n.continued_from_key='extra-'||e.id)",
        own,
        ctx.today,
      )
      .filter((r) => atLeast(ctx.user, r.vertical_id, 'member'));
    return {
      items: [...extra, ...legacy, ...standalone]
        .filter((r) => !ctx.query.project || r.project_id === Number(ctx.query.project))
        .sort((a, b) => b.report_date.localeCompare(a.report_date))
        .slice(0, 50),
    };
  });

  route('POST', '/development-reporting', (ctx) => {
    const b = ctx.body;
    if (
      ['status', 'start_time', 'completion_time', 'elapsed_ms', 'total_ms', 'state'].some(
        (k) => b[k] !== undefined,
      )
    )
      throw bad('Status and timings are automatic. Use the timer after adding work.');
    if (b.assignee_id !== undefined && Number(b.assignee_id) !== ctx.user.id)
      throw forbidden('Daily work is added by the developer for themselves');
    const p = openProject(ctx, b.project_id),
      parent = ctx.db.get(
        'SELECT * FROM tasks WHERE id=? AND project_id=?',
        toId(b.parent_task_id, 'Main task'),
        p.id,
      );
    if (
      !parent ||
      parent.assignee_id !== ctx.user.id ||
      !websiteDevelopers(p).includes(ctx.user.id)
    )
      throw forbidden('Choose a main task assigned to you in this project');
    if (parent.status === 'review')
      throw bad(
        'This task is awaiting review. The head must request changes before more daily work is added.',
      );
    if (parent.status === 'done')
      throw bad('This main task is complete. Ask the head to reopen it before adding more work.');
    const title = text(b.title, { max: 240, required: true, label: "Today's module / work" });
    if (!title) throw bad("Describe today's module / work");
    const date = optDate(b.report_date || ctx.today, 'Work date');
    if (!date || date > ctx.today) throw bad('Daily work cannot be dated in the future');
    const remarks = text(b.remarks, { max: 8000 }) || '';
    let source = null,
      sourceKey = '';
    if (b.continue_from) {
      source = call(ctx, 'GET', '/daily-reporting/' + b.continue_from);
      if (
        source.assignee_id !== ctx.user.id ||
        source.project_id !== p.id ||
        (source.parent_task_id || source.task_id) !== parent.id
      )
        throw forbidden('Continue your own work against the same main task');
      if (
        !(
          ['Under process', 'Paused', 'Not Started'].includes(source.status) ||
          (source.status === 'Done' && source.revision_pending)
        ) ||
        source.running_since
      )
        throw bad('Mark unfinished work Under process before continuing it');
      if (source.report_date >= date) throw bad('Choose a later date to continue this work');
      sourceKey = String(source.id);
      if (date !== ctx.today) throw bad('Continue work into today');
      const existing = ctx.db.get(
        'SELECT id FROM extra_work WHERE continued_from_key=? AND report_date=? AND assignee_id=?',
        sourceKey,
        date,
        ctx.user.id,
      );
      if (existing) return { id: 'extra-' + existing.id, continued: true };
    }
    return ctx.db.tx(() => {
      const { id } = ctx.db.run(
        'INSERT INTO extra_work (vertical_id,title,client_label,work_type,reporting_team,parent_task_id,continued_from_key,report_date,assignee_id,created_by,remarks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        p.vertical_id,
        title,
        p.client,
        parent.stage || 'Development',
        'development',
        parent.id,
        sourceKey,
        date,
        ctx.user.id,
        ctx.user.id,
        remarks,
        ctx.now,
        ctx.now,
      );
      const key = 'extra-' + id;
      ctx.db.run(
        'INSERT INTO report_work (work_key,extra_id,revision_no,updated_at) VALUES (?,?,?,?)',
        key,
        id,
        source ? source.revision_no + (source.revision_pending ? 1 : 0) : 0,
        ctx.now,
      );
      if (source?.revision_pending) {
        ctx.db.run('UPDATE report_work SET revision_pending=0 WHERE work_key=?', source.work_key);
        if (source.last_note)
          addWorkNote(ctx, key, source.last_note, 'revision_request', source.revision_no + 1);
      }
      if (source)
        addWorkNote(
          ctx,
          key,
          'Continued from ' + source.report_date + ' · ' + source.title,
          'note',
        );
      return { id: key, work_key: key, parent_task_id: parent.id };
    });
  });
  route('POST', '/development-reporting/:id/continue', (ctx) => {
    const source = call(ctx, 'GET', '/daily-reporting/' + ctx.params.id);

    if (!source.project_id && source.reporting_team === 'development') {
      if (source.assignee_id !== ctx.user.id) throw forbidden('Continue your own daily work');
      if (
        source.report_date >= ctx.today ||
        !(
          ['Under process', 'Paused', 'Not Started'].includes(source.status) ||
          (source.status === 'Done' && source.revision_pending)
        ) ||
        source.running_since
      )
        throw bad('Choose unfinished work from an earlier date');
      const existing = ctx.db.get(
        'SELECT id FROM extra_work WHERE continued_from_key=? AND report_date=? AND assignee_id=?',
        String(source.id),
        ctx.today,
        ctx.user.id,
      );
      if (existing) return { id: 'extra-' + existing.id, continued: true };
      return ctx.db.tx(() => {
        const result = call(ctx, 'POST', '/daily-reporting', {
          title: source.title,
          report_date: ctx.today,
          remarks: ctx.body.remarks || '',
          reporting_team: 'development',
          vertical_id: source.vertical_id,
          client_label: source.client,
          work_type: source.work_type,
        });
        ctx.db.run(
          'UPDATE extra_work SET continued_from_key=? WHERE id=?',
          String(source.id),
          Number(result.id.slice(6)),
        );
        ctx.db.run(
          'UPDATE report_work SET revision_no=? WHERE work_key=?',
          source.revision_no + (source.revision_pending ? 1 : 0),
          result.work_key,
        );
        if (source.revision_pending) {
          ctx.db.run('UPDATE report_work SET revision_pending=0 WHERE work_key=?', source.work_key);
          if (source.last_note)
            addWorkNote(
              ctx,
              result.work_key,
              source.last_note,
              'revision_request',
              source.revision_no + 1,
            );
        }
        addWorkNote(
          ctx,
          result.work_key,
          'Continued from ' + source.report_date + ' · ' + source.title,
          'note',
        );
        return result;
      });
    }
    if (!source.project_id || !isDevelopmentProject(source))
      throw bad('Choose development daily work to continue');
    return call(ctx, 'POST', '/development-reporting', {
      project_id: source.project_id,
      parent_task_id: source.parent_task_id || source.task_id,
      title: source.title,
      remarks: ctx.body.remarks || '',
      report_date: ctx.today,
      continue_from: source.id,
    });
  });
}
