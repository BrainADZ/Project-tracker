// Small hash router so links and the back button work.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterCtx = createContext(null);
const readHash = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];

export function RouterProvider({ children }) {
  const [stack, setStack] = useState(() => [readHash()]);
  const path = stack[stack.length - 1];

  useEffect(() => {
    const on = () => setStack((s) => [...s.slice(-30), readHash()]);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState(null, '', '#' + to);
      setStack((s) => [...s.slice(0, -1), to]);
    } else window.location.hash = to;
    if (!replace) window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(
    (fallback = '/') => {
      if (stack.length > 1) window.history.back();
      else navigate(fallback);
    },
    [stack.length, navigate],
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
      href={'#' + to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        onClick?.(e);
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
