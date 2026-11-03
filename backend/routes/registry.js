import { HttpError } from '../services/util.js';

// Dispatch stays synchronous so related controller calls can run inside the
// same database transaction.
export function createRouteRegistry() {
  const routes = [];

  function route(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
    );
    routes.push({ method, re, keys, handler });
  }

  function call(ctx, method, path, body = ctx.body) {
    ctx = { ...ctx, body };
    for (const rt of routes) {
      if (rt.method !== method) continue;
      const m = rt.re.exec(path);
      if (!m) continue;
      const params = {};
      rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const c = { ...ctx, params, query: ctx.query || {}, body: ctx.body || {} };
      c.today = ctx.services.today();
      c.now = ctx.services.now();
      return rt.handler(c);
    }
    throw new HttpError(404, 'Not found', 'not_found');
  }

  return { route, call };
}
