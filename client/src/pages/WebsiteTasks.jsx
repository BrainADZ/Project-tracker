import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Download } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { Modal, Field, Loading, ErrorNote, Empty } from '../ui.jsx';
import {
  WEBSITE_STAGES,
  websiteDevelopers,
  canChooseWorkContact,
} from '../../../backend/services/project-services.js';
import { duration } from '../report-utils.js';
import WebsiteTaskReview from './WebsiteTaskReview.jsx';
import { fmtDate } from '../format.js';

const label = (s) =>
  s === 'done'
    ? 'Done'
    : s === 'review'
      ? 'Ready for review'
      : s === 'todo'
        ? 'Not started'
        : 'Under process';
export default function WebsiteTasks({ p, onSeen }) {
  const { me, users, today, toast, refresh } = useApp();
  const { data, loading, error, reload } = useLoad(
    () => api.get('/projects/' + p.id + '/tasks'),
    [p.id],
  );
  const [form, setForm] = useState(null),
    [f, setF] = useState({}),
    [saving, setSaving] = useState(false),
    [saveError, setError] = useState(null);
  const can = canChooseWorkContact(me, p),
    tasks = data?.items || [],
    developers = users.filter((u) => websiteDevelopers(p).includes(u.id));
  const seen = useRef(false);
  useEffect(() => {
    if (data && onSeen && !seen.current) {
      seen.current = true;
      onSeen();
    }
  }, [data, onSeen]);
  useEffect(() => {
    const fresh = () => {
      if (document.visibilityState === 'visible') reload({ quiet: true });
    };
    const timer = setInterval(fresh, 5000);
    document.addEventListener('visibilitychange', fresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', fresh);
    };
  }, [reload]);
  const open = (t) => {
    setForm(t || 'new');
    setError(null);
    setF(
      t
        ? {
            title: t.title,
            description: t.description,
            stage: t.stage,
            assignee_id: t.assignee_id,
            start_date: t.start_date || today,
            due_date: t.due_date || today,
            status: t.status,
          }
        : {
            title: '',
            description: '',
            stage: 'Design',
            assignee_id: developers[0]?.id || '',
            start_date: today,
            due_date: p.due_date && p.due_date >= today ? p.due_date : today,
            status: 'todo',
          },
    );
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const changed = () => {
    reload({ quiet: true });
    refresh();
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (form === 'new') await api.post('/projects/' + p.id + '/tasks', f);
      else await api.patch('/tasks/' + form.id, f);
      setForm(null);
      changed();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  const status = async (t, value) => {
    try {
      await api.patch('/tasks/' + t.id, { status: value });
      changed();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const exportRows = () => {
    const cell = (v) =>
      '"' +
      String(v ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    api
      .saveText(
        p.code + '-main-tasks.csv',
        '\uFEFF' +
          [
            [
              'Main task',
              'Phase',
              'Developer',
              'Deadline',
              'Status',
              'Daily entries',
              'Total active time',
            ],
            ...tasks.map((t) => [
              t.title,
              t.stage,
              t.assignee_name,
              t.due_date,
              label(t.status),
              t.daily_entries,
              duration(t.elapsed_ms),
            ]),
          ]
            .map((r) => r.map(cell).join(','))
            .join('\r\n'),
      )
      .catch((e) => toast(e.message, 'error'));
  };
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Main tasks</h2>
          <div className="sub">
            {can
              ? 'Assign the main tasks here. Developers add their daily modules in Development Reporting.'
              : 'Your assigned main tasks. Add today’s module in Development Reporting.'}
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn"
            disabled={!tasks.length}
            onClick={exportRows}
          >
            <Download size={15} />
            Export
          </button>
          {can && p.open && (
            <button
              className="btn primary"
              onClick={() => open(null)}
            >
              <Plus size={15} />
              Add task
            </button>
          )}
        </div>
      </div>
      <ErrorNote
        error={error}
        retry={reload}
      />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table website-main-tasks">
              <thead>
                <tr>
                  <th>Main task</th>
                  <th>Phase</th>
                  {can && <th>Developer</th>}
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Daily entries</th>
                  <th>Total time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link
                        className="b6"
                        to={'/projects/' + p.id + '/tasks/' + t.id}
                      >
                        {t.title}
                      </Link>
                      {t.description && <div className="small muted mt-4">{t.description}</div>}
                    </td>
                    <td>{t.stage}</td>
                    {can && <td>{t.assignee_name}</td>}
                    <td className="nowrap">{fmtDate(t.due_date)}</td>
                    <td>
                      {can && p.open && t.review?.latest?.status !== 'pending' ? (
                        <select
                          className="select sm"
                          aria-label={'Status of ' + t.title}
                          value={t.status}
                          onChange={(e) => status(t, e.target.value)}
                        >
                          <option value="todo">Not started</option>
                          <option value="in_progress">Under process</option>
                          <option value="done">Done</option>
                          {!['todo', 'in_progress', 'done'].includes(t.status) && (
                            <option value={t.status}>{label(t.status)}</option>
                          )}
                        </select>
                      ) : (
                        <span
                          className={
                            'badge ' +
                            (t.status === 'done'
                              ? 'b-blue'
                              : t.status === 'todo'
                                ? 'b-gray'
                                : 'b-amber')
                          }
                        >
                          {label(t.status)}
                        </span>
                      )}
                    </td>
                    <td>{t.daily_entries || 0}</td>
                    <td className="work-total">
                      {duration(t.elapsed_ms)}
                      {t.running && <div className="xs green mt-4">Timer running</div>}
                    </td>
                    <td>
                      <WebsiteTaskReview
                        task={t}
                        compact
                        onChanged={changed}
                      />
                      {can && (
                        <button
                          className="icon-btn"
                          disabled={!p.open || t.review?.latest?.status === 'pending'}
                          aria-label={'Edit ' + t.title}
                          onClick={() => open(t)}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tasks.length && (
            <Empty title="No main tasks yet">
              {can
                ? 'Add a main task such as UI design or checkout development.'
                : 'The head will assign your main tasks here.'}
            </Empty>
          )}
        </div>
      )}
      {form && (
        <Modal
          title={form === 'new' ? 'Add main task' : 'Edit main task'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                form="website-main-task-form"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save task'}
              </button>
            </>
          }
        >
          <form
            id="website-main-task-form"
            className="modal-body form-grid"
            onSubmit={save}
          >
            <div className="full">
              <ErrorNote error={saveError} />
            </div>
            <Field
              label="Main task"
              className="full"
            >
              <input
                className="input"
                required
                maxLength={240}
                value={f.title}
                onChange={set('title')}
                placeholder="e.g. UI design, frontend development, payment integration"
              />
            </Field>
            <Field label="Phase">
              <select
                className="select"
                value={f.stage}
                onChange={set('stage')}
              >
                {WEBSITE_STAGES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Assigned developer">
              <select
                className="select"
                required
                value={f.assignee_id}
                onChange={set('assignee_id')}
              >
                <option value="">Choose developer</option>
                {developers.map((u) => (
                  <option
                    key={u.id}
                    value={u.id}
                  >
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date">
              <input
                type="date"
                className="input"
                required
                value={f.start_date}
                onChange={set('start_date')}
              />
            </Field>
            <Field label="Deadline">
              <input
                type="date"
                className="input"
                required
                min={f.start_date}
                value={f.due_date}
                onChange={set('due_date')}
              />
            </Field>
            <Field
              label="Brief / instructions"
              className="full"
            >
              <textarea
                className="input"
                rows={3}
                maxLength={8000}
                value={f.description}
                onChange={set('description')}
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}
