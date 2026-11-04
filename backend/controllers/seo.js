import { bad, forbidden, notFound, text, toId, parseJSON } from '../services/util.js';
import { canView, canEditProject, atLeast } from '../models/access.js';
import { reportingMonth } from '../services/social-progress.js';

function project(ctx, write = false) {
  const p = ctx.db.get('SELECT * FROM projects WHERE id=?', toId(ctx.params.id, 'SEO project'));
  if (!p || p.service_type !== 'seo' || !canView(ctx.user, p)) throw notFound('SEO project');
  if (write) {
    if (['completed', 'cancelled'].includes(p.status)) throw bad('Reopen the SEO project first');
    const specialist = Number(parseJSON(p.service_details, {}).specialist_id) === ctx.user.id;
    if (
      !atLeast(ctx.user, p.vertical_id, 'member') ||
      (!canEditProject(ctx.user, p) && !specialist)
    )
      throw forbidden('Only the SEO manager or assigned executive can update this tracker');
  }
  return p;
}

function wholeNumber(value, label, max = 1000000000) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw bad(`Enter a valid ${label}`);
  return n;
}

function keyword(ctx, projectId) {
  const row = ctx.db.get(
    'SELECT * FROM seo_keywords WHERE id=? AND project_id=?',
    toId(ctx.params.keywordId, 'Keyword'),
    projectId,
  );
  if (!row) throw notFound('Keyword');
  return row;
}

export function registerSeo(route) {
  route('GET', '/projects/:id/seo', (ctx) => {
    const p = project(ctx);
    const month = reportingMonth(ctx.query.month, ctx.today);
    const report = ctx.db.get(
      'SELECT * FROM seo_monthly_reports WHERE project_id=? AND report_month=?',
      p.id,
      month,
    ) || {
      organic_sessions: 0,
      clicks: 0,
      impressions: 0,
      indexed_pages: 0,
      notes: '',
    };
    const keywords = ctx.db.all(
      `SELECT k.id,k.keyword,k.target_url,k.search_volume,r.position,
        (SELECT previous.position FROM seo_keyword_ranks previous
         WHERE previous.keyword_id=k.id AND previous.report_month<?
         ORDER BY previous.report_month DESC LIMIT 1) AS previous_position
       FROM seo_keywords k LEFT JOIN seo_keyword_ranks r
         ON r.keyword_id=k.id AND r.report_month=?
       WHERE k.project_id=? AND k.active=1 ORDER BY LOWER(k.keyword),k.id`,
      month,
      month,
      p.id,
    );
    return {
      month,
      report,
      keywords,
      summary: {
        tracked: keywords.length,
        ranked: keywords.filter((k) => k.position != null).length,
        top_three: keywords.filter((k) => k.position > 0 && k.position <= 3).length,
        top_ten: keywords.filter((k) => k.position > 0 && k.position <= 10).length,
        improved: keywords.filter(
          (k) => k.position > 0 && k.previous_position > 0 && k.position < k.previous_position,
        ).length,
      },
      can_edit:
        !['completed', 'cancelled'].includes(p.status) &&
        atLeast(ctx.user, p.vertical_id, 'member') &&
        (canEditProject(ctx.user, p) ||
          Number(parseJSON(p.service_details, {}).specialist_id) === ctx.user.id),
    };
  });

  route('PUT', '/projects/:id/seo/report', (ctx) => {
    const p = project(ctx, true);
    const b = ctx.body;
    const month = reportingMonth(b.month, ctx.today);
    const report = {
      organic_sessions: wholeNumber(b.organic_sessions, 'organic sessions'),
      clicks: wholeNumber(b.clicks, 'clicks'),
      impressions: wholeNumber(b.impressions, 'impressions'),
      indexed_pages: wholeNumber(b.indexed_pages, 'indexed pages'),
      notes: text(b.notes, { max: 8000 }) || '',
    };
    ctx.db.run(
      `INSERT INTO seo_monthly_reports
       (project_id,report_month,organic_sessions,clicks,impressions,indexed_pages,notes,updated_by,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,report_month) DO UPDATE SET
       organic_sessions=excluded.organic_sessions,clicks=excluded.clicks,
       impressions=excluded.impressions,indexed_pages=excluded.indexed_pages,
       notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      p.id,
      month,
      report.organic_sessions,
      report.clicks,
      report.impressions,
      report.indexed_pages,
      report.notes,
      ctx.user.id,
      ctx.now,
    );
    return { month, ...report };
  });

  route('POST', '/projects/:id/seo/keywords', (ctx) => {
    const p = project(ctx, true);
    const name = text(ctx.body.keyword, { max: 120, label: 'Keyword', required: true });
    const target = text(ctx.body.target_url, { max: 500, label: 'Target URL' }) || '';
    const volume = wholeNumber(ctx.body.search_volume ?? 0, 'search volume');
    const existing = ctx.db.get(
      'SELECT id,active FROM seo_keywords WHERE project_id=? AND LOWER(keyword)=LOWER(?)',
      p.id,
      name,
    );
    if (existing?.active) throw bad('This keyword is already tracked');
    if (existing) {
      ctx.db.run(
        'UPDATE seo_keywords SET keyword=?,target_url=?,search_volume=?,active=1,updated_at=? WHERE id=?',
        name,
        target,
        volume,
        ctx.now,
        existing.id,
      );
      return { id: existing.id };
    }
    if (
      ctx.db.get('SELECT COUNT(*) AS n FROM seo_keywords WHERE project_id=? AND active=1', p.id)
        .n >= 500
    )
      throw bad('A project can track up to 500 keywords');
    return {
      id: ctx.db.run(
        'INSERT INTO seo_keywords(project_id,keyword,target_url,search_volume,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        p.id,
        name,
        target,
        volume,
        ctx.now,
        ctx.now,
      ).id,
    };
  });

  route('PATCH', '/projects/:id/seo/keywords/:keywordId', (ctx) => {
    const p = project(ctx, true);
    const k = keyword(ctx, p.id);
    const name = text(ctx.body.keyword ?? k.keyword, {
      max: 120,
      label: 'Keyword',
      required: true,
    });
    const target =
      text(ctx.body.target_url ?? k.target_url, { max: 500, label: 'Target URL' }) || '';
    const volume = wholeNumber(ctx.body.search_volume ?? k.search_volume, 'search volume');
    const duplicate = ctx.db.get(
      'SELECT id FROM seo_keywords WHERE project_id=? AND LOWER(keyword)=LOWER(?) AND id!=?',
      p.id,
      name,
      k.id,
    );
    if (duplicate) throw bad('This keyword is already tracked');
    ctx.db.run(
      'UPDATE seo_keywords SET keyword=?,target_url=?,search_volume=?,updated_at=? WHERE id=?',
      name,
      target,
      volume,
      ctx.now,
      k.id,
    );
    return { id: k.id, keyword: name, target_url: target, search_volume: volume };
  });

  route('PUT', '/projects/:id/seo/keywords/:keywordId/rank', (ctx) => {
    const p = project(ctx, true);
    const k = keyword(ctx, p.id);
    if (!k.active) throw bad('Restore this keyword before updating its rank');
    const month = reportingMonth(ctx.body.month, ctx.today);
    if (ctx.body.position === null || ctx.body.position === '') {
      ctx.db.run(
        'DELETE FROM seo_keyword_ranks WHERE keyword_id=? AND report_month=?',
        k.id,
        month,
      );
      return { keyword_id: k.id, month, position: null };
    }
    const position = wholeNumber(ctx.body.position, 'keyword position', 1000);
    if (!position) throw bad('Keyword position must be from 1 to 1000');
    ctx.db.run(
      `INSERT INTO seo_keyword_ranks(keyword_id,report_month,position,updated_by,updated_at)
       VALUES (?,?,?,?,?) ON CONFLICT(keyword_id,report_month) DO UPDATE SET
       position=excluded.position,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      k.id,
      month,
      position,
      ctx.user.id,
      ctx.now,
    );
    return { keyword_id: k.id, month, position };
  });

  route('DELETE', '/projects/:id/seo/keywords/:keywordId', (ctx) => {
    const p = project(ctx, true);
    const k = keyword(ctx, p.id);
    ctx.db.run('UPDATE seo_keywords SET active=0,updated_at=? WHERE id=?', ctx.now, k.id);
    return { ok: true };
  });
}
