import { useEffect, useState } from 'react';
import { FolderKanban, ListChecks, Images, Lock, LogIn } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Logo } from '../Layout.jsx';
import { Avatar, Field } from '../ui.jsx';
import { WEBSITE_DEMO_PEOPLE, websiteDemoEmail } from '../../../backend/seeds/website-demo.js';

const QUICK_ACCOUNTS = [
  { label: 'Admin · all verticals', email: 'rajiv.malhotra@brainadz.com' },
  { label: 'Exhibits manager', email: 'suresh.iyer@brainadz.com' },
  { label: 'Marketing manager', email: 'manager.demo@brainadz.com' },
  { label: 'Live manager', email: 'arvind.menon@brainadz.com' },
  { label: 'Marketing · Social/content (demo)', email: 'priti.demo@brainadz.com' },
  { label: 'Marketing · Designer (demo)', email: 'komal.demo@brainadz.com' },
  { label: 'Marketing · Sales (demo)', email: 'sales.demo@brainadz.com' },
  ...WEBSITE_DEMO_PEOPLE.map(p=>({label:p.title+' (demo)',email:websiteDemoEmail(p.key)})),
];

export default function Login() {
  const { loadBoot } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState('BrainADZ');
  const demo = api.isDemo();

  useEffect(() => {
    if (!demo) fetch('/api/auth/config').then((r) => r.json()).then((c) => setCompany(c.company_name || 'BrainADZ')).catch(() => {});
  }, [demo]);

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bpm': '1' }, body: JSON.stringify({ email, password }), credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not sign in');
      await loadBoot();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };
  const pick = async (acc) => {
    window.__pmDemo.signIn(acc.email);
    await loadBoot();
  };

  return (
    <div className="login">
      <div className="left">
        <Logo />
        <div>
          <h2>Every project across {company} verticals, in one place.</h2>
          <p>Plan events, exhibitions and campaigns, keep each team on deadline, and find any past project with its files in seconds.</p>
          <div className="row wrap" style={{ gap: 18, marginTop: 28 }}>
            {[[FolderKanban, 'Projects & stages'], [ListChecks, 'Tasks & deadlines'], [Images, 'Files & assets'], [Lock, 'Access by vertical']].map(([Ic, l]) => (
              <span key={l} className="row" style={{ gap: 8, color: 'rgba(255,255,255,.9)', fontSize: 14 }}><Ic size={18} />{l}</span>
            ))}
          </div>
        </div>
        <div style={{ fontFamily: 'Caveat, cursive', fontSize: 30, opacity: 0.9 }}>Plan · Track · Deliver</div>
      </div>
      <div className="right">
        <div className="box">
          {demo ? (
            <>
              <h1 style={{ fontSize: 28, letterSpacing: '-0.5px' }}>Try the demo</h1>
              <p className="muted mt-8" style={{ lineHeight: 1.5 }}>Pick a person to see the app through their eyes. Each one has access to different verticals, so they see different projects.</p>
              <div className="col mt-16" style={{ gap: 8 }}>
                {window.__pmDemo.accounts().map((a) => (
                  <button key={a.key} type="button" className="demo-acc" onClick={() => pick(a)}>
                    <Avatar name={a.name} color={a.color} size={36} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="b6" style={{ display: 'block' }}>{a.name}</span>
                      <span className="xs muted" style={{ display: 'block' }}>{a.label} · {a.title}</span>
                    </span>
                    <LogIn size={17} className="muted" />
                  </button>
                ))}
              </div>
              <p className="xs muted mt-16" style={{ lineHeight: 1.5 }}>Sample people, clients and projects are fictional. Changes you make stay in this browser only.</p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 28, letterSpacing: '-0.5px' }}>Sign in</h1>
              <p className="muted mt-8">Welcome back to {company} Projects.</p>
              <form className="col" style={{ gap: 14, marginTop: 24 }} onSubmit={signIn}>
                {err && <div className="alert error">{err}</div>}
                <Field label="Work email" htmlFor="login-email"><input id="login-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus /></Field>
                <Field label="Password" htmlFor="login-pass"><input id="login-pass" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
                <button type="submit" className="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
                <p className="xs muted">Forgot your password? Ask an admin to reset it under Team & Access.</p>
              </form>
              {import.meta.env.DEV && (
                <section className="col mt-16" aria-label="Temporary test access" style={{ gap: 10, padding: 16, border: '1px solid var(--border, #dce2ec)', borderRadius: 12 }}>
                  <div className="b6">Temporary test access</div>
                  <p className="xs muted" style={{ lineHeight: 1.5 }}>Choose an account to fill the form, then click Sign in. Password: <code>demo1234</code></p>
                  {QUICK_ACCOUNTS.map((account) => (
                    <button key={account.email} type="button" className="demo-acc" disabled={busy} onClick={() => { setEmail(account.email); setPassword('demo1234'); setErr(null); }}>
                      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                        <span className="b6" style={{ display: 'block' }}>{account.label}</span>
                        <span className="xs muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>{account.email}</span>
                      </span>
                      <LogIn size={17} className="muted" />
                    </button>
                  ))}
                  <p className="xs muted" style={{ lineHeight: 1.5 }}>Marketing accounts: <code>npm run seed:marketing</code>. Other sample accounts: <code>npm run seed:demo</code>.</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
