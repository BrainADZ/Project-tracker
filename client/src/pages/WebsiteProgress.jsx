import { Progress } from '../ui.jsx';
export default function WebsiteProgress({ summary: s, software = false }) {
  if (!s) return null;
  return (
    <section
      className="website-progress"
      aria-label={software ? 'Software progress' : 'Website progress'}
    >
      <div className="row wrap between">
        <div>
          <h3>{software ? 'Software progress' : 'Website progress'}</h3>
          <p className="small muted mt-4">
            Main task progress updates here; developers record daily modules in Development
            Reporting.
          </p>
        </div>
        <strong>
          {s.done} / {s.total} tasks done · {s.percent}%
        </strong>
      </div>
      <div
        className="mt-12"
        role="progressbar"
        aria-label={software ? 'Software tasks completed' : 'Website tasks completed'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s.percent}
      >
        <Progress value={s.percent} color="var(--blue)" />
      </div>
      <div className="website-phases">
        {s.phases.map((p, i) => (
          <div
            key={p.name}
            className={
              'website-phase ' +
              (p.total && p.done === p.total
                ? 'done'
                : s.current_phase === p.name && !s.ready
                  ? 'current'
                  : '')
            }
          >
            <span className="website-phase-number">{i + 1}</span>
            <div>
              <b>{p.name}</b>
              <small>{p.total ? p.done + ' / ' + p.total + ' tasks done' : 'No tasks yet'}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="social-work-counts">
        <span>
          <b>{s.running}</b> running
        </span>
        <span>
          <b>{s.paused}</b> under process
        </span>
        <span>
          <b>{s.ready_for_review || 0}</b> ready for review
        </span>
        <span>
          <b>{s.changes_requested}</b> changes requested
        </span>
        <span className={s.overdue ? 'red' : ''}>
          <b>{s.overdue}</b> overdue
        </span>
        {s.ready && (
          <span className="green">All tasks done · head can mark the project delivered</span>
        )}
      </div>
    </section>
  );
}
