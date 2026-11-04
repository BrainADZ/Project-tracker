import { Progress } from '../ui.jsx';

export default function SocialProgress({
  summary: s,
  month,
  onMonthChange,
  loading,
  kind = 'social',
}) {
  if (!s) return null;
  const seo = kind === 'seo';
  const item = seo ? 'SEO work items' : 'creatives';
  const label = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(s.month + '-01T00:00:00Z'));
  return (
    <section
      className="social-monthly"
      aria-label={seo ? 'Monthly SEO work progress' : 'Monthly creative progress'}
      aria-busy={loading}
    >
      <div className="row wrap between">
        <div>
          <h3>
            {label} · {seo ? 'SEO work' : 'Monthly work'}
          </h3>
          <p className="small muted mt-4">
            Updates automatically from daily work. The project continues each month.
          </p>
        </div>
        <div className="row wrap gap-6">
          <input
            className="input sm"
            type="month"
            aria-label="Progress month"
            value={month || s.month}
            onChange={(e) => {
              if (e.target.value) onMonthChange(e.target.value);
            }}
          />
          {month && (
            <button
              type="button"
              className="btn sm"
              onClick={() => onMonthChange('')}
            >
              This month
            </button>
          )}
        </div>
      </div>
      <div className="social-target-line">
        <strong>
          {s.done} / {s.target || '—'} {item} done
        </strong>
        <span>{s.target ? s.remaining + ' remaining' : 'Set the monthly target in Edit'}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label + (seo ? ' SEO work target' : ' creative target')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s.percent}
        aria-valuetext={s.done + ' of ' + s.target + ' ' + item + ' done'}
      >
        <Progress
          value={s.percent}
          color="var(--cyan)"
        />
      </div>
      <div className="social-work-counts">
        <span>
          <b>{s.assigned}</b> assigned
        </span>
        <span>
          <b>{s.unassigned}</b> yet to assign
        </span>
        <span>
          <b>{s.running}</b> running
        </span>
        <span>
          <b>{s.paused}</b> paused
        </span>
        <span>
          <b>{s.changes_requested}</b> changes requested
        </span>
        <span className={s.overdue ? 'red' : ''}>
          <b>{s.overdue}</b> delayed
        </span>
      </div>
    </section>
  );
}
