import Notes from './WorkNotes.jsx';
import DevelopmentReporting from './DevelopmentReporting.jsx';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Download,
  Search,
  Pencil,
  MessagesSquare,
  Play,
  Pause,
  Check,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Link, useRouter } from '../router.jsx';
import { Modal, Field, Loading, ErrorNote, Empty } from '../ui.jsx';
import { WORK_TYPES } from '../../../backend/controllers/daily-reporting.js';
import {
  isDevelopmentProject,
  canChooseWorkContact,
  websiteDevelopers,
  WEBSITE_STAGES,
} from '../../../backend/services/project-services.js';
import {
  REPORTING_DEPARTMENTS,
  projectReportingDepartment,
  reportingPath,
} from '../../../backend/services/reporting-access.js';
import { fmtDate } from '../format.js';

const duration = (ms) => {
  const sec = Math.floor(Math.max(0, ms || 0) / 1000);
  return (
    String(Math.floor(sec / 3600)).padStart(2, '0') +
    ':' +
    String(Math.floor(sec / 60) % 60).padStart(2, '0') +
    ':' +
    String(sec % 60).padStart(2, '0')
  );
};
const clock = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '');
const colour = (s) =>
  s === 'Done' ? 'b-blue' : s === 'Paused' ? 'b-amber' : s === 'In Process' ? 'b-green' : 'b-gray';

export function GeneralDailyReporting({
  projectId,
  department: requestedDepartment,
  initialDate,
  initialScope = 'day',
  embedded = false,
  onSeen,
  onDateChange,
}) {
  const {
    today,
    me,
    users,
    verticals,
    toast,
    bumpCounts,
    refresh,
    reportingDepartment: defaultDepartment,
  } = useApp();
  const { navigate } = useRouter();
  const designerMode =
    /designer|design|editor|developer|creative|seo executive|ads executive/i.test(me.title || '');
  const [date, setDate] = useState(initialDate || today),
    [scope, setScope] = useState(initialScope),
    [query, setQuery] = useState(''),
    [person, setPerson] = useState(''),
    [form, setForm] = useState(null),
    [f, setF] = useState({}),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(null),
    [notes, setNotes] = useState(null),
    [busyRows, setBusyRows] = useState([]);
  useEffect(() => {
    if (initialDate && initialDate.slice(0, 7) !== date.slice(0, 7)) setDate(initialDate);
  }, [initialDate, date]);
  const [tick, setTick] = useState(0),
    [base, setBase] = useState({ server: Date.now(), local: Date.now() });
  const projects = useLoad(() => api.get('/projects', { scope: 'all' }), []);
  const contextProject = (projects.data?.items || []).find((p) => p.id === Number(projectId));
  const department =
    requestedDepartment ||
    (projectId
      ? contextProject
        ? projectReportingDepartment(contextProject)
        : undefined
      : defaultDepartment);
  const report = useLoad(
    () => api.get('/daily-reporting', { date, scope, project: projectId, department }),
    [date, scope, projectId, department],
  );
  const reloadReport = report.reload;
  const currentDepartment = department || report.data?.department || defaultDepartment,
    websiteContext = currentDepartment === 'development',
    canViewTeam = !!report.data?.can_view_team;
  const reportPeople = users.filter((u) => report.data?.member_ids?.includes(u.id));
  const seen = useRef(false);
  useEffect(() => {
    if (report.data && onSeen && !seen.current) {
      seen.current = true;
      onSeen();
    }
  }, [report.data, onSeen]);
  useEffect(() => {
    if (report.data?.server_now)
      setBase({ server: new Date(report.data.server_now).getTime(), local: Date.now() });
  }, [report.data?.server_now]);
  useEffect(() => {
    const clock = setInterval(() => setTick((v) => v + 1), 1000);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') reloadReport({ quiet: true });
    }, 4000);
    const fresh = () => {
      if (document.visibilityState === 'visible') reloadReport({ quiet: true });
    };
    document.addEventListener('visibilitychange', fresh);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', fresh);
    };
  }, [reloadReport]);
  const serverNow = base.server + (Date.now() - base.local);
  const elapsed = (r) =>
    r.total_ms +
    (r.running_since ? Math.max(0, serverNow - new Date(r.running_since).getTime()) : 0);
  const revisionTime = (r) =>
    r.current_revision_ms +
    (r.running_since ? Math.max(0, serverNow - new Date(r.running_since).getTime()) : 0);
  const items = (report.data?.items || []).filter(
    (r) =>
      (!canViewTeam || !person || [r.social_id, r.assignee_id].includes(Number(person))) &&
      (!query ||
        (r.client + ' ' + r.project_name + ' ' + r.title)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const projectList = (projects.data?.items || []).filter(
      (p) => projectReportingDepartment(p) === currentDepartment,
    ),
    active = projectList.filter(
      (p) =>
        !['completed', 'cancelled'].includes(p.status) &&
        (me.role === 'admin' || ['member', 'manager'].includes(me.access?.[p.vertical_id])) &&
        (!isDevelopmentProject(p) ||
          canChooseWorkContact(me, p) ||
          websiteDevelopers(p).includes(me.id)),
    );
  const allPeople = users.filter(
    (u) =>
      u.role === 'admin' ||
      Object.values(u.access || {}).some((level) => ['member', 'manager'].includes(level)),
  );
  const selected = projectList.find((p) => p.id === Number(f.project_id));
  const websiteForm = isDevelopmentProject(selected);
  const canSelectContact = !websiteForm && canChooseWorkContact(me, selected);
  const pool = selected
    ? allPeople.filter(
        (u) =>
          u.role === 'admin' || ['member', 'manager'].includes(u.access?.[selected.vertical_id]),
      )
    : allPeople;
  const developerPool = websiteForm
    ? pool.filter((u) => websiteDevelopers(selected).includes(u.id))
    : pool;
  const chooseAssignee = (p) =>
    isDevelopmentProject(p)
      ? !canChooseWorkContact(me, p) && websiteDevelopers(p).includes(me.id)
        ? me.id
        : websiteDevelopers(p)[0] || ''
      : p
        ? designerMode
          ? me.id
          : p.service_details?.specialist_id || ''
        : me.id;
  const workTypes =
    WORK_TYPES[selected?.service_type || (websiteContext ? 'website' : 'other')] ||
    WORK_TYPES.other;
  const set = (key) => (e) => setF((x) => ({ ...x, [key]: e.target.value }));
  const changed = () => {
    report.reload({ quiet: true });
    bumpCounts();
    refresh();
  };
  const chooseProject = (id) => {
    const p = projectList.find((p) => p.id === Number(id)),
      d = p?.service_details || {};
    setF((x) => ({
      ...x,
      project_id: id,
      social_id: d.lead_id || (canChooseWorkContact(me, p) ? '' : me.id),
      assignee_id: chooseAssignee(p),
      stage: p?.website?.current_phase || 'Design',
      due_date: p?.due_date && p.due_date >= x.report_date ? p.due_date : x.report_date,
      work_type:
        WORK_TYPES[p?.service_type || (websiteContext ? 'website' : 'other')]?.[0] || 'Graphic',
    }));
  };
  const open = (row) => {
    const p =
        projectList.find((p) => p.id === Number(projectId)) || (!designerMode ? active[0] : null),
      d = p?.service_details || {},
      workDate = scope === 'project' ? today : date;
    setError(null);
    setForm(row || 'new');
    setF(
      row
        ? {
            project_id: row.project_id || '',
            report_date: row.report_date,
            title: row.title,
            work_type: row.work_type,
            social_id: row.social_id || '',
            assignee_id: row.assignee_id,
            remarks: row.remarks,
            client_label: row.project_id ? '' : row.client,
            stage: row.stage || 'Design',
            due_date: row.due_date || row.report_date,
          }
        : {
            project_id: p?.id || '',
            report_date: workDate,
            title: '',
            work_type:
              WORK_TYPES[p?.service_type || (websiteContext ? 'website' : 'other')]?.[0] ||
              'Graphic',
            social_id: d.lead_id || '',
            assignee_id: chooseAssignee(p),
            remarks: '',
            client_label: '',
            stage: p?.website?.current_phase || 'Design',
            due_date: p?.due_date && p.due_date >= workDate ? p.due_date : workDate,
          },
    );
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...f, reporting_team: currentDepartment };
      if (!canSelectContact) delete body.social_id;
      if (websiteForm) body.work_type = f.stage;
      else {
        delete body.stage;
        delete body.due_date;
      }
      if (!f.project_id) {
        body.assignee_id = me.id;
        body.vertical_id = verticals.find((v) =>
          ['member', 'manager'].includes(me.access?.[v.id]),
        )?.id;
      }
      if (form === 'new') await api.post('/daily-reporting', body);
      else await api.patch('/daily-reporting/' + form.id, body);
      setForm(null);
      changed();
      if (projectId && !f.project_id) navigate(reportingPath(currentDepartment));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  const act = async (r, action) => {
    setBusyRows((ids) => [...ids, r.id]);
    try {
      await api.post('/daily-reporting/' + r.id + '/action', { action });
      changed();
    } catch (e) {
      toast(e.message, 'error');
      report.reload({ quiet: true });
    } finally {
      setBusyRows((ids) => ids.filter((id) => id !== r.id));
    }
  };
  const exportRows = () => {
    const cell = (v) => {
      const s = String(v ?? '');
      return '"' + (/^[=+@-]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
    };
    const rows = [
      [
        'Assigned date',
        'Client',
        'Project / extra work',
        'Work',
        'Type',
        ...(websiteContext ? ['Developer'] : ['Content person', 'Designer']),
        'Started',
        'Completed',
        'Status',
        'Total active time',
        'Active time in selected period',
        'Revision',
        'Latest note',
        'Brief',
      ],
      ...items.map((r) => [
        r.report_date,
        r.client,
        r.project_name,
        r.title,
        r.work_type,
        ...(websiteContext ? [r.designer_name] : [r.social_name, r.designer_name]),
        stamp(r.first_started_at),
        stamp(r.completed_at),
        r.status,
        duration(elapsed(r)),
        duration(r.period_ms),
        r.revision_no,
        r.last_note,
        r.remarks,
      ]),
    ];
    api
      .saveText(
        currentDepartment + '-reporting-' + date + '.csv',
        '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n'),
      )
      .catch((e) => toast(e.message, 'error'));
  };
  return (
    <>
      <div className="page-head">
        <div>
          {embedded ? (
            <h2>
              {websiteContext
                ? scope === 'project'
                  ? 'Website tasks'
                  : 'Daily reporting'
                : 'Daily work'}
            </h2>
          ) : (
            <h1>{REPORTING_DEPARTMENTS[currentDepartment]}</h1>
          )}
          <div className="sub">
            {canViewTeam
              ? 'Team reporting. Assign work and track status and active time.'
              : 'Your work only. Status and active time update on the same row.'}
          </div>
        </div>
        <div className="head-actions">
          <button className="btn" disabled={!items.length} onClick={exportRows}>
            <Download size={16} />
            Export
          </button>
          {report.data?.can_add && (
            <button className="btn primary" onClick={() => open(null)}>
              <Plus size={16} />
              {websiteContext ? 'Add task' : designerMode ? 'Add own work' : 'Add / assign work'}
            </button>
          )}
        </div>
      </div>
      <ErrorNote
        error={report.error || projects.error}
        retry={() => {
          report.reload();
          projects.reload();
        }}
      />
      {!embedded && (
        <div className="daily-stats">
          {[
            ['Total work', items.length],
            ['Running', items.filter((r) => r.status === 'In Process').length],
            ['Paused', items.filter((r) => r.status === 'Paused').length],
            ['Done', items.filter((r) => r.status === 'Done').length],
          ].map(([title, n]) => (
            <div className="card" key={title}>
              <span className="muted small">{title}</span>
              <b>{n}</b>
            </div>
          ))}
        </div>
      )}
      <div className="filters mb-16 daily-filters">
        {scope !== 'project' && (
          <input
            type="date"
            className="input"
            aria-label="Reporting date"
            value={date}
            onChange={(e) => {
              if (e.target.value) {
                setDate(e.target.value);
                onDateChange?.(e.target.value);
              }
            }}
          />
        )}
        <select
          className="select"
          aria-label="Day or month"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          {websiteContext && projectId && <option value="project">All project tasks</option>}
          <option value="day">This date</option>
          <option value="month">Full month</option>
        </select>
        <div className="input-icon">
          <Search size={16} />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client or work"
            aria-label="Search reporting"
          />
        </div>
        {canViewTeam && (
          <>
            <select
              className="select"
              aria-label="Filter team member"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">All team members</option>
              {reportPeople.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              onClick={() => setPerson(person === String(me.id) ? '' : String(me.id))}
            >
              {person === String(me.id) ? 'Show all' : 'Only mine'}
            </button>
          </>
        )}
        {projectId && !embedded && (
          <Link className="btn" to={'/projects/' + projectId}>
            Back to project
          </Link>
        )}
      </div>
      {report.loading && !report.data ? (
        <Loading />
      ) : (
        <div className="card flush daily-report-card">
          <div
            className="table-wrap daily-scroll"
            tabIndex={0}
            role="region"
            aria-label="Daily work report"
          >
            <table className="table daily-sheet timed-sheet">
              <colgroup>
                <col style={{ width: '3%' }} />
                {scope === 'month' && <col style={{ width: '8%' }} />}
                <col style={{ width: '13%' }} />
                <col
                  style={{
                    width:
                      scope === 'month'
                        ? websiteContext
                          ? '13%'
                          : '12%'
                        : websiteContext
                          ? '18%'
                          : '17%',
                  }}
                />
                {!websiteContext && <col style={{ width: '9%' }} />}
                <col style={{ width: '9%' }} />
                {websiteContext && <col style={{ width: '8%' }} />}
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: scope === 'month' ? '8%' : '11%' }} />
                <col style={{ width: '9%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {scope === 'month' && <th scope="col">Date</th>}
                  <th scope="col" className="work-client">
                    Client / project
                  </th>
                  <th scope="col">Work / content</th>
                  {!websiteContext && <th scope="col">Social / content</th>}
                  <th scope="col">{websiteContext ? 'Developer' : 'Assigned to'}</th>
                  {websiteContext && <th scope="col">Deadline</th>}
                  <th scope="col">Start</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total time</th>
                  <th scope="col">Notes</th>
                  <th scope="col" className="work-action-cell">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => {
                  const busy = busyRows.includes(r.id);
                  return (
                    <tr key={r.work_key} className={r.running_since ? 'work-row-running' : ''}>
                      <td className="muted">{i + 1}</td>
                      {scope === 'month' && <td className="nowrap">{fmtDate(r.report_date)}</td>}
                      <td className="work-client">
                        {r.project_id ? (
                          <Link className="b6" to={'/projects/' + r.project_id}>
                            {r.client || r.project_name}
                          </Link>
                        ) : (
                          <b>{r.client || 'Extra work'}</b>
                        )}
                        <div className="xs muted daily-project-name" title={r.project_name}>
                          {r.project_name}
                        </div>
                      </td>
                      <td className="daily-work-title">
                        {websiteContext && r.project_id ? (
                          <Link className="b6" to={'/projects/' + r.project_id + '/tasks/' + r.id}>
                            {r.title}
                          </Link>
                        ) : (
                          <b>{r.title}</b>
                        )}
                        <div className="work-kind">
                          <span>
                            {isDevelopmentProject(r)
                              ? r.stage === r.work_type
                                ? r.stage
                                : r.stage + ' · ' + r.work_type
                              : r.work_type}
                          </span>
                          {r.revision_no > 0 && <span>Revision {r.revision_no}</span>}
                        </div>
                      </td>
                      {!websiteContext && <td className="work-person">{r.social_name || '—'}</td>}
                      <td className="work-person">{r.designer_name || 'Unassigned'}</td>
                      {websiteContext && (
                        <td
                          className={
                            'report-due ' +
                            ((r.status !== 'Done' || r.revision_pending) && r.due_date < today
                              ? 'red'
                              : '')
                          }
                        >
                          {r.due_date ? fmtDate(r.due_date) : '—'}
                        </td>
                      )}
                      <td className="report-time-cell" title={stamp(r.first_started_at)}>
                        {clock(r.first_started_at)}
                      </td>
                      <td className="report-time-cell" title={stamp(r.completed_at)}>
                        {clock(r.completed_at)}
                      </td>
                      <td>
                        <span className={'badge ' + colour(r.status)}>
                          {r.running_since && <span className="work-running-dot" />}
                          {r.status}
                        </span>
                        {!!r.revision_pending && (
                          <div className="xs red mt-8">Changes requested</div>
                        )}
                      </td>
                      <td className={'work-total ' + (r.running_since ? 'is-running' : '')}>
                        <b>{duration(elapsed(r))}</b>
                        {r.revision_no > 0 && (
                          <div className="xs muted mt-4">Revision: {duration(revisionTime(r))}</div>
                        )}
                      </td>
                      <td className="work-note-cell">
                        <button className="link small" onClick={() => setNotes({ id: r.id })}>
                          <MessageSquare size={13} />
                          {r.note_count ? r.note_count + ' notes' : 'Add note'}
                        </button>
                        <p className="xs muted" title={r.last_note || r.remarks || ''}>
                          {r.last_note || r.remarks || '—'}
                        </p>
                      </td>
                      <td className="work-action-cell">
                        <div className="work-controls">
                          {r.can_timer && (
                            <>
                              {r.status === 'Not Started' && (
                                <button
                                  className="btn sm primary"
                                  disabled={busy}
                                  onClick={() => act(r, 'start')}
                                >
                                  <Play size={13} />
                                  Start
                                </button>
                              )}
                              {r.status === 'In Process' && (
                                <button
                                  className="btn sm"
                                  disabled={busy}
                                  onClick={() => act(r, 'pause')}
                                >
                                  <Pause size={13} />
                                  Pause
                                </button>
                              )}
                              {r.status === 'Paused' && (
                                <button
                                  className="btn sm primary"
                                  disabled={busy}
                                  onClick={() => act(r, 'resume')}
                                >
                                  <Play size={13} />
                                  Resume
                                </button>
                              )}
                              {['In Process', 'Paused'].includes(r.status) && (
                                <button
                                  className="btn sm success"
                                  disabled={busy}
                                  onClick={() => act(r, 'done')}
                                >
                                  <Check size={13} />
                                  Done
                                </button>
                              )}
                              {r.status === 'Done' &&
                                (r.revision_pending ? (
                                  <button
                                    className="btn sm primary"
                                    disabled={busy}
                                    onClick={() => act(r, 'reopen')}
                                  >
                                    <RotateCcw size={13} />
                                    Start revision
                                  </button>
                                ) : (
                                  <button
                                    className="btn sm"
                                    disabled={busy}
                                    onClick={() => setNotes({ id: r.id, action: 'reopen' })}
                                  >
                                    <RotateCcw size={13} />
                                    Rework
                                  </button>
                                ))}
                            </>
                          )}
                          {!r.can_timer &&
                            r.status === 'Done' &&
                            r.can_request_revision &&
                            !r.revision_pending && (
                              <button
                                className="btn sm"
                                onClick={() => setNotes({ id: r.id, action: 'request_revision' })}
                              >
                                Request changes
                              </button>
                            )}
                          {!r.can_timer && r.status !== 'Done' && (
                            <span className="xs muted">Assignee updates</span>
                          )}
                          {r.can_edit && (
                            <button
                              className="icon-btn"
                              title="Edit brief / assignment"
                              aria-label={'Edit ' + r.title}
                              onClick={() => open(r)}
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {r.project_id && (
                            <Link
                              className="icon-btn"
                              to={'/teams/' + r.project_id}
                              title="Project group"
                            >
                              <MessagesSquare size={15} />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!items.length && (
            <Empty title="No work in this view">
              {canViewTeam
                ? 'No team work matches these filters.'
                : 'Your assigned work and own extra work will appear here.'}
            </Empty>
          )}
        </div>
      )}
      {form && (
        <Modal
          title={
            form === 'new'
              ? websiteForm
                ? 'Add website task'
                : designerMode
                  ? 'Add own work'
                  : 'Assign work'
              : 'Edit work brief'
          }
          sub="Status and timings are set by the assigned person, using the timer."
          onClose={() => setForm(null)}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                form="daily-work-form"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save work'}
              </button>
            </>
          }
        >
          <form id="daily-work-form" className="modal-body form-grid" onSubmit={save}>
            <div className="full">
              <ErrorNote error={error} />
            </div>
            <Field label="Project">
              <select
                className="select"
                disabled={form !== 'new'}
                value={f.project_id}
                onChange={(e) => chooseProject(e.target.value)}
              >
                <option value="">Other / extra work — no project</option>
                {(form === 'new' ? active : projectList).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.client ? p.client + ' · ' : ''}
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={websiteForm ? 'Task start date' : 'Work date'}>
              <input
                className="input"
                type="date"
                required
                value={f.report_date}
                onChange={set('report_date')}
              />
            </Field>
            {!f.project_id && (
              <Field label="Client / requested by (optional)" className="full">
                <input
                  className="input"
                  maxLength={160}
                  value={f.client_label || ''}
                  onChange={set('client_label')}
                  placeholder="Internal team, a different client, urgent extra work…"
                />
              </Field>
            )}
            <Field label="Work / content" className="full">
              <input
                className="input"
                required
                maxLength={240}
                value={f.title}
                onChange={set('title')}
                placeholder="What needs to be designed or completed?"
              />
            </Field>
            {!websiteForm && (
              <Field label="Work type">
                <select className="select" value={f.work_type} onChange={set('work_type')}>
                  {[...new Set([f.work_type, ...workTypes])].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            )}
            {websiteForm && (
              <Field label="Website phase">
                <select
                  className="select"
                  required
                  value={f.stage || 'Design'}
                  onChange={set('stage')}
                >
                  {WEBSITE_STAGES.map((phase) => (
                    <option key={phase}>{phase}</option>
                  ))}
                </select>
              </Field>
            )}
            {f.project_id ? (
              <>
                {canSelectContact && (
                  <Field label="Social / content person">
                    <select
                      className="select"
                      value={f.social_id || ''}
                      onChange={set('social_id')}
                    >
                      <option value="">Not applicable</option>
                      {pool.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={websiteForm ? 'Developer' : 'Assigned designer / person'}>
                  <select
                    className="select"
                    disabled={websiteForm && !canChooseWorkContact(me, selected)}
                    required
                    value={f.assignee_id || ''}
                    onChange={set('assignee_id')}
                  >
                    <option value="">Choose assigned person</option>
                    {developerPool.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {websiteForm && (
                  <Field label="Task deadline">
                    <input
                      className="input"
                      type="date"
                      required
                      min={f.report_date}
                      value={f.due_date || f.report_date}
                      onChange={set('due_date')}
                    />
                  </Field>
                )}
              </>
            ) : (
              <p className="small muted">Assigned to you: {me.name}</p>
            )}
            <Field label="Brief / notes" className="full">
              <textarea
                className="input"
                rows={3}
                maxLength={8000}
                value={f.remarks}
                onChange={set('remarks')}
                placeholder="Instructions, dimensions, reference links or context"
              />
            </Field>
          </form>
        </Modal>
      )}
      {notes && (
        <Notes
          id={notes.id}
          department={currentDepartment}
          initialAction={notes.action}
          onClose={() => setNotes(null)}
          onChanged={changed}
        />
      )}
    </>
  );
}

export default function DailyReporting(props) {
  const { reportingDepartment } = useApp();
  const needsProject = props.projectId && !props.department;
  const context = useLoad(
    () => (needsProject ? api.get('/projects/' + props.projectId) : null),
    [props.projectId, props.department],
  );
  if (needsProject && !context.data)
    return context.error ? <ErrorNote error={context.error} /> : <Loading />;
  const department =
    props.department ||
    (needsProject ? projectReportingDepartment(context.data) : reportingDepartment);
  return department === 'development' ? (
    <DevelopmentReporting {...props} />
  ) : (
    <GeneralDailyReporting {...props} department={department} />
  );
}
