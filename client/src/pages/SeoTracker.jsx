import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad } from '../store.jsx';
import { Empty, ErrorNote, Field, Loading } from '../ui.jsx';

const metricFields = [
  ['organic_sessions', 'Organic sessions'],
  ['clicks', 'Search clicks'],
  ['impressions', 'Search impressions'],
  ['indexed_pages', 'Indexed pages'],
];

export default function SeoTracker({ project, month, onMonthChange }) {
  const { today, toast, confirm } = useApp();
  const selectedMonth = month || today.slice(0, 7);
  const { data, loading, error, reload } = useLoad(
    () => api.get(`/projects/${project.id}/seo`, { month: selectedMonth }),
    [project.id, selectedMonth],
  );
  const [reportDraft, setReportDraft] = useState(null);
  const [keywordDraft, setKeywordDraft] = useState({
    keyword: '',
    target_url: '',
    search_volume: '',
  });
  const [editingKeyword, setEditingKeyword] = useState(null);
  const [rankDrafts, setRankDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const run = async (action, success) => {
    setBusy(true);
    setFormError('');
    try {
      await action();
      await reload({ quiet: true });
      if (success) toast(success, 'success');
      return true;
    } catch (err) {
      setFormError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveReport = async (event) => {
    event.preventDefault();
    if (
      await run(
        () =>
          api.put(`/projects/${project.id}/seo/report`, { ...reportDraft, month: selectedMonth }),
        'SEO report saved',
      )
    )
      setReportDraft(null);
  };
  const addKeyword = async (event) => {
    event.preventDefault();
    if (
      await run(
        () => api.post(`/projects/${project.id}/seo/keywords`, keywordDraft),
        'Keyword added',
      )
    )
      setKeywordDraft({ keyword: '', target_url: '', search_volume: '' });
  };
  const saveKeyword = async (event) => {
    event.preventDefault();
    if (
      await run(
        () =>
          api.patch(`/projects/${project.id}/seo/keywords/${editingKeyword.id}`, editingKeyword),
        'Keyword updated',
      )
    )
      setEditingKeyword(null);
  };
  const saveRank = async (keyword) => {
    const value = rankDrafts[keyword.id] ?? String(keyword.position ?? '');
    if (
      await run(
        () =>
          api.put(`/projects/${project.id}/seo/keywords/${keyword.id}/rank`, {
            month: selectedMonth,
            position: value === '' ? null : value,
          }),
        'Rank saved',
      )
    )
      setRankDrafts((current) => {
        const next = { ...current };
        delete next[keyword.id];
        return next;
      });
  };
  const archiveKeyword = async (keyword) => {
    const approved = await confirm({
      title: `Stop tracking “${keyword.keyword}”?`,
      message: 'Its past monthly rankings stay saved. You can add the keyword again later.',
      confirmLabel: 'Stop tracking',
    });
    if (approved)
      await run(
        () => api.del(`/projects/${project.id}/seo/keywords/${keyword.id}`),
        'Keyword removed from active tracking',
      );
  };

  if (loading && !data) return <Loading />;
  if (error && !data)
    return (
      <ErrorNote
        error={error}
        retry={() => reload()}
      />
    );
  if (!data) return null;
  const canEdit = data.can_edit;

  return (
    <div
      className="seo-tracker col"
      style={{ gap: 16 }}
    >
      <section className="card">
        <div
          className="row wrap between"
          style={{ gap: 12 }}
        >
          <div>
            <h3>SEO performance</h3>
            <p className="small muted mt-4">Monthly search results and keyword positions.</p>
          </div>
          <input
            className="input sm"
            type="month"
            aria-label="SEO reporting month"
            value={selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </div>
        {formError && <div className="alert error mt-12">{formError}</div>}
        <div className="seo-metrics">
          {metricFields.map(([key, label]) => (
            <div
              key={key}
              className="seo-metric"
            >
              <span className="small muted">{label}</span>
              <strong>{Number(data.report[key] || 0).toLocaleString('en-IN')}</strong>
            </div>
          ))}
          {[
            ['Tracked keywords', data.summary.tracked],
            ['Top 10 keywords', data.summary.top_ten],
            ['Improved rankings', data.summary.improved],
          ].map(([label, value]) => (
            <div
              key={label}
              className="seo-metric"
            >
              <span className="small muted">{label}</span>
              <strong>
                {value}
                {label === 'Tracked keywords' && Number(project.service_details.keyword_count) > 0
                  ? ` / ${project.service_details.keyword_count}`
                  : ''}
              </strong>
            </div>
          ))}
        </div>
        {data.report.notes && !reportDraft && (
          <p className="small seo-notes">{data.report.notes}</p>
        )}
        {canEdit && !reportDraft && (
          <button
            type="button"
            className="btn mt-16"
            onClick={() => setReportDraft({ ...data.report })}
          >
            Edit monthly report
          </button>
        )}
        {reportDraft && (
          <form
            className="col mt-16"
            style={{ gap: 12 }}
            onSubmit={saveReport}
          >
            <div className="seo-metric-form">
              {metricFields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                >
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="1000000000"
                    required
                    value={reportDraft[key]}
                    onChange={(event) =>
                      setReportDraft((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Monthly notes">
              <textarea
                className="input"
                rows={4}
                maxLength={8000}
                value={reportDraft.notes}
                onChange={(event) =>
                  setReportDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </Field>
            <div className="row wrap gap-6">
              <button
                type="submit"
                className="btn primary"
                disabled={busy}
              >
                Save report
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setReportDraft(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <div
          className="row wrap between"
          style={{ gap: 12 }}
        >
          <div>
            <h3>Keyword rankings</h3>
            <p className="small muted mt-4">
              Enter each keyword’s search position for {selectedMonth}.
            </p>
          </div>
          <span className="small muted">
            {data.summary.ranked} ranked / {data.summary.tracked} tracked
          </span>
        </div>
        {data.keywords.length ? (
          <div className="seo-keyword-list mt-16">
            {data.keywords.map((keyword) => (
              <div
                key={keyword.id}
                className="seo-keyword-row"
              >
                <div className="seo-keyword-name">
                  <strong>{keyword.keyword}</strong>
                  <span className="xs muted">
                    {keyword.target_url || 'No target URL'} ·{' '}
                    {keyword.search_volume.toLocaleString('en-IN')} searches/month
                  </span>
                </div>
                <span className="small muted">Previous: {keyword.previous_position ?? '—'}</span>
                {canEdit ? (
                  <div className="row wrap gap-6">
                    <input
                      className="input sm seo-rank-input"
                      type="number"
                      min="1"
                      max="1000"
                      aria-label={`Rank for ${keyword.keyword}`}
                      placeholder="Rank"
                      value={rankDrafts[keyword.id] ?? String(keyword.position ?? '')}
                      onChange={(event) =>
                        setRankDrafts((current) => ({
                          ...current,
                          [keyword.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => saveRank(keyword)}
                    >
                      Save rank
                    </button>
                  </div>
                ) : (
                  <strong>#{keyword.position ?? '—'}</strong>
                )}
                {canEdit && (
                  <div className="row wrap gap-6">
                    <button
                      type="button"
                      className="link"
                      onClick={() => setEditingKeyword({ ...keyword })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link red"
                      onClick={() => archiveKeyword(keyword)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No keywords tracked yet">
            Add the first keyword to start recording rankings.
          </Empty>
        )}
        {canEdit && (
          <form
            className="seo-add-keyword mt-16"
            onSubmit={addKeyword}
          >
            <Field label="Keyword">
              <input
                className="input"
                required
                maxLength={120}
                value={keywordDraft.keyword}
                onChange={(event) =>
                  setKeywordDraft((current) => ({ ...current, keyword: event.target.value }))
                }
              />
            </Field>
            <Field label="Target URL">
              <input
                className="input"
                maxLength={500}
                value={keywordDraft.target_url}
                onChange={(event) =>
                  setKeywordDraft((current) => ({ ...current, target_url: event.target.value }))
                }
              />
            </Field>
            <Field label="Monthly search volume">
              <input
                className="input"
                type="number"
                min="0"
                max="1000000000"
                value={keywordDraft.search_volume}
                onChange={(event) =>
                  setKeywordDraft((current) => ({ ...current, search_volume: event.target.value }))
                }
              />
            </Field>
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
            >
              Add keyword
            </button>
          </form>
        )}
      </section>

      {editingKeyword && (
        <section className="card">
          <h3>Edit keyword</h3>
          <form
            className="seo-add-keyword mt-16"
            onSubmit={saveKeyword}
          >
            <Field label="Keyword">
              <input
                className="input"
                required
                maxLength={120}
                value={editingKeyword.keyword}
                onChange={(event) =>
                  setEditingKeyword((current) => ({ ...current, keyword: event.target.value }))
                }
              />
            </Field>
            <Field label="Target URL">
              <input
                className="input"
                maxLength={500}
                value={editingKeyword.target_url}
                onChange={(event) =>
                  setEditingKeyword((current) => ({ ...current, target_url: event.target.value }))
                }
              />
            </Field>
            <Field label="Monthly search volume">
              <input
                className="input"
                type="number"
                min="0"
                max="1000000000"
                value={editingKeyword.search_volume}
                onChange={(event) =>
                  setEditingKeyword((current) => ({
                    ...current,
                    search_volume: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="row wrap gap-6">
              <button
                type="submit"
                className="btn primary"
                disabled={busy}
              >
                Save keyword
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setEditingKeyword(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
