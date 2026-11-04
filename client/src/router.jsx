// Small history router so app links use ordinary paths and the back button works.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterCtx = createContext(null);
const readPath = () => window.location.pathname || '/';

function initialPath() {
  // Existing shared/bookmarked hash links should continue to open the same page.
  if (window.location.hash.startsWith('#/')) {
    const oldPath = window.location.hash.slice(1);
    window.history.replaceState(window.history.state, '', oldPath);
  }
  if (window.history.state?.bpmDepth === undefined)
    window.history.replaceState({ ...window.history.state, bpmDepth: 0 }, '', window.location.href);
  return readPath();
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(initialPath);

  useEffect(() => {
    const on = () => setPath(readPath());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const depth = window.history.state?.bpmDepth || 0;
    const nextPath = to.split('?')[0];
    if (replace) {
      window.history.replaceState({ ...window.history.state, bpmDepth: depth }, '', to);
    } else if (to !== window.location.pathname + window.location.search) {
      window.history.pushState({ bpmDepth: depth + 1 }, '', to);
    }
    setPath(nextPath);
    if (!replace) window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(
    (fallback = '/') => {
      if (window.history.state?.bpmDepth > 0) window.history.back();
      else navigate(fallback);
    },
    [navigate],
  );

  const value = useMemo(() => ({ path, navigate, back }), [path, navigate, back]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

// match('/projects/:id', '/projects/12') -> { id: '12' } | null
export function match(pattern, path) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
  );
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

export function Link({ to, children, className, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0 ||
          (e.currentTarget.target && e.currentTarget.target !== '_self') ||
          e.currentTarget.hasAttribute('download')
        )
          return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
