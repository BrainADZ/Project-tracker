import { useEffect } from 'react';
import { useApp } from './store.jsx';
import { useRouter, match } from './router.jsx';
import { api } from './api.js';
import { Layout, Logo } from './Layout.jsx';
import { Empty } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import Project from './pages/Project.jsx';
import MyWork from './pages/MyWork.jsx';
import Assets from './pages/Assets.jsx';
import Archive from './pages/Archive.jsx';
import Team from './pages/Team.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import ProfileEdit from './pages/ProfileEdit.jsx';
import Teams from './pages/Teams.jsx';
import DailyReporting from './pages/DailyReporting.jsx';

function Routes() {
  const { path, navigate } = useRouter();
  const { dailyReportingOnly, defaultReportingPath, reportingDepartment } = useApp();
  useEffect(() => {
    if ((path === '/my' && dailyReportingOnly)||path==='/daily-reporting') navigate(defaultReportingPath, { replace: true });
  }, [path, dailyReportingOnly, defaultReportingPath, navigate]);
  let m;
  if (path === '/' || path === '') return <Dashboard />;
  if (path === '/my') return dailyReportingOnly ? <DailyReporting /> : <MyWork />;
  if (path === '/projects') return <Projects />;
  if ((m = match('/projects/:id/tasks/:taskId', path))) return <Project id={m.id} tab="tasks" taskId={m.taskId} />;
  if ((m = match('/projects/:id/:tab', path))) return <Project id={m.id} tab={m.tab} />;
  if ((m = match('/projects/:id', path))) return <Project id={m.id} />;
  if (path === '/daily-reporting/social' || path === '/marketing') return <DailyReporting key="social" department="social" />;
  if (path === '/daily-reporting/development') return <DailyReporting key="development" department="development" />;
  if (path === '/daily-reporting/other') return <DailyReporting key="other" department="other" />;
  if (path === '/daily-reporting') return <DailyReporting department={reportingDepartment} />;
  if ((m = match('/daily-reporting/:id', path))) return <DailyReporting projectId={m.id} />;
  if ((m = match('/marketing/:id', path))) return <DailyReporting />;
  if (path === '/teams') return <Teams />;
  if ((m = match('/teams/:id', path))) return <Teams id={m.id} />;
  if (path === '/assets') return <Assets />;
  if (path === '/archive') return <Archive />;
  if (path === '/team') return <Team />;
  if ((m = match('/settings/:tab', path))) return <Settings tab={m.tab} />;
  if (path === '/settings') return <Settings />;
  if (path === '/profile') return <Profile />;
  if (path === '/profile/edit') return <ProfileEdit />;
  return <div className="card"><Empty title="Page not found">That link does not lead anywhere. Use the menu to find your way.</Empty></div>;
}

function Boot({ label }) {
  return (
    <div className="demo-boot">
      <Logo size="sm" />
      <b>{label}</b>
      <span>Getting your projects ready</span>
      <div className="bar" />
    </div>
  );
}

export default function App() {
  const { boot, bootError, me, loadBoot, setBoot } = useApp();
  const { navigate } = useRouter();
  if (bootError && !boot) {
    return (
      <div className="demo-boot">
        <b>Could not reach the server</b>
        <span>{bootError}</span>
        <button type="button" className="btn primary" onClick={loadBoot}>Try again</button>
      </div>
    );
  }
  if (boot === null) return <Boot label="Loading BrainADZ Projects" />;
  if (boot === false) return <Login />;

  const signOut = async () => {
    if (api.isDemo()) window.__pmDemo.signOut();
    else await api.post('/auth/logout').catch(() => {});
    navigate('/', { replace: true });
    setBoot(false);
  };

  if (me.must_change_password && !api.isDemo()) {
    return (
      <Layout onSignOut={signOut}>
        <Profile forced />
      </Layout>
    );
  }
  return (
    <>
      <Layout onSignOut={signOut}>
        <Routes key={me.id} />
      </Layout>
    </>
  );
}

