import { useState } from 'react';
import { useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, Loading, ErrorNote } from '../ui.jsx';
import { duration, stamp } from '../report-utils.js';

export default function WorkNotes({ id, department, initialAction, onClose, onChanged }) {
  const {
    data: r,
    error,
    loading,
    reload,
  } = useLoad(() => api.get('/daily-reporting/' + id, { department }), [id, department]);
  const [note, setNote] = useState(''),
    [action, setAction] = useState(initialAction || 'note'),
    [busy, setBusy] = useState(false),
    [saveError, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (action === 'note') await api.post('/daily-reporting/' + id + '/notes', { note });
      else await api.post('/daily-reporting/' + id + '/action', { action, note });
      setNote('');
      setAction('note');
      reload({ quiet: true });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const cycles = new Map();
  for (const s of r?.sessions || [])
    cycles.set(
      s.revision_no,
      (cycles.get(s.revision_no) || 0) +
        s.duration_ms +
        (s.ended_at ? 0 : Math.max(0, new Date(r.server_now) - new Date(s.started_at))),
    );
  return (
    <Modal
      title={r?.title || 'Notes & revisions'}
      sub={
        department === 'development'
          ? 'Notes and active time stay with this daily entry.'
          : 'Notes and revision time stay with this same work item.'
      }
      onClose={onClose}
      size="wide"
    >
      <div className="modal-body">
        <ErrorNote error={error || saveError} retry={reload} />
        {loading && !r ? (
          <Loading />
        ) : (
          r && (
            <>
              <div className="work-history-totals">
                <b>Total active time: {duration(r.elapsed_ms)}</b>
                {[...cycles].map(([n, ms]) => (
                  <span key={n}>
                    {n === 0 ? 'Original work' : 'Revision ' + n}: {duration(ms)}
                  </span>
                ))}
              </div>
              {r.remarks && (
                <div className="work-note">
                  <b>Original brief</b>
                  <p>{r.remarks}</p>
                </div>
              )}
              {r.revision_pending > 0 && (
                <div className="alert info mt-12">
                  Changes requested. The assigned person can start the revision; earlier time stays
                  saved.
                </div>
              )}
              {(r.notes || [])
                .filter((n) => n.kind !== 'event')
                .map((n) => (
                  <div className="work-note" key={n.id}>
                    <div className="row between">
                      <b>
                        {n.author_name}
                        {n.kind === 'revision_request' ? ' · Revision ' + n.revision_no : ''}
                      </b>
                      <small className="muted">{stamp(n.created_at)}</small>
                    </div>
                    <p>{n.note}</p>
                  </div>
                ))}
              {r.can_note && (
                <form className="col mt-16" onSubmit={submit}>
                  <Field label="Add note / changes">
                    <textarea
                      className="input"
                      rows={3}
                      required
                      maxLength={8000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What changed, what needs fixing, or an update for the team…"
                    />
                  </Field>
                  <div className="row wrap">
                    <select
                      className="select"
                      aria-label="Note action"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    >
                      <option value="note">Add note</option>
                      {r.status === 'Done' && r.can_request_revision && !r.revision_pending && (
                        <option value="request_revision">Request changes</option>
                      )}
                      {r.status === 'Done' && r.can_timer && (
                        <option value="reopen">Start working on revision</option>
                      )}
                    </select>
                    <button className="btn primary" disabled={busy}>
                      {busy
                        ? 'Saving…'
                        : action === 'reopen'
                          ? 'Start revision'
                          : action === 'request_revision'
                            ? 'Request changes'
                            : 'Add note'}
                    </button>
                  </div>
                </form>
              )}
              {!!r.sessions.length && (
                <details className="mt-16">
                  <summary className="small muted">Timer history</summary>
                  {r.sessions.map((s) => (
                    <div className="work-note small" key={s.id}>
                      {s.revision_no ? 'Revision ' + s.revision_no : 'Original'} · {s.designer_name}
                      <p>
                        {stamp(s.started_at)} → {s.ended_at ? stamp(s.ended_at) : 'Running'} ·{' '}
                        {duration(
                          s.duration_ms +
                            (s.ended_at
                              ? 0
                              : Math.max(0, new Date(r.server_now) - new Date(s.started_at))),
                        )}
                      </p>
                    </div>
                  ))}
                </details>
              )}
            </>
          )
        )}
      </div>
    </Modal>
  );
}
