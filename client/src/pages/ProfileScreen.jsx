import { useRef, useState } from 'react';
import {
  Camera,
  Pencil,
  Mail,
  Phone,
  CalendarDays,
  MapPin,
  Lock,
  Plus,
  X,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../store.jsx';
import { useRouter, Link } from '../router.jsx';
import { api } from '../api.js';
import { Avatar, Field, VChip } from '../ui.jsx';
import { fmtDate } from '../format.js';
import '../profile.css';

const personal = [
  'about',
  'address',
  'dob',
  'emergency_contact',
  'skills',
  'certifications',
  'photo',
];
const employment = [
  'department',
  'employment_type',
  'work_place',
  'location',
  'join_date',
  'manager_id',
];
const date = (value) => (value ? fmtDate(value.slice(0, 10)) : 'Not provided');
const valueOrBlank = (value) => value || '';
async function readPhoto(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024)
    throw new Error('Choose a PNG, JPEG or WebP photo under 1 MB');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(file);
  });
}
function Person({ person }) {
  return (
    <div className="profile-person">
      <Avatar name={person.name} color={person.color} photo={person.photo} size={32} />
      <div>
        <b>{person.name}</b>
        <span>{person.title || 'Team member'}</span>
      </div>
    </div>
  );
}
function Details({ rows }) {
  return (
    <dl className="profile-details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || 'Not provided'}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProfileOverview({ forced = false }) {
  const { me, users, verticals, toast, loadBoot } = useApp(),
    { navigate } = useRouter();
  const [busy, setBusy] = useState(false),
    [password, setPassword] = useState(''),
    [again, setAgain] = useState(''),
    [error, setError] = useState('');
  const photoRef = useRef(null),
    p = me.profile || {};
  const manager = users.find((u) => u.id === p.manager_id),
    reports = users.filter((u) => u.manager_id === me.id);
  const team = reports.length
    ? reports
    : users.filter(
        (u) => u.id !== me.id && Object.keys(u.access || {}).some((id) => me.access?.[id]),
      );
  const photo = async (file) => {
    setBusy(true);
    try {
      const data = await readPhoto(file);
      if (data) {
        await api.patch('/me', { profile: { photo: data } });
        await loadBoot();
        toast('Photo updated', 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (forced) return <ProfilePassword forced />;
  const skills = (p.skills || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="profile-page">
      <section className="card profile-shell">
        <header className="profile-header">
          <div className="profile-photo">
            <div className="profile-photo-wrap">
              <Avatar name={me.name} color={me.color} photo={p.photo || me.photo} size={102} />
              <span className="profile-active" title="Active account" />
            </div>
            <button className="btn sm" disabled={busy} onClick={() => photoRef.current?.click()}>
              <Camera size={14} />
              Change photo
            </button>
            <input
              ref={photoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                photo(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="profile-heading">
            <div className="row between wrap gap-12">
              <div>
                <div className="row wrap gap-8">
                  <h1>{me.name}</h1>
                  <span className="badge b-blue">{me.employee_code}</span>
                </div>
                <p className="muted mt-4">{me.title || 'Team member'}</p>
              </div>
              <Link className="btn primary" to="/profile/edit">
                <Pencil size={15} />
                Edit Profile
              </Link>
            </div>
            <div className="row wrap gap-8 mt-12">
              {verticals.map((v) => (
                <VChip
                  key={v.id}
                  name={v.short + (p.department ? ' · ' + p.department : '')}
                  color={v.color}
                  small
                />
              ))}
              {p.employment_type && <span className="badge b-blue">{p.employment_type}</span>}
              {p.location && (
                <span className="row gap-4 small">
                  <MapPin size={14} />
                  {p.location}
                </span>
              )}
            </div>
            <div className="profile-contact row wrap mt-12">
              <span>
                <Mail size={14} />
                {me.email}
              </span>
              {me.phone && (
                <span>
                  <Phone size={14} />
                  {me.phone}
                </span>
              )}
              {p.join_date && (
                <span>
                  <CalendarDays size={14} />
                  Joined {date(p.join_date)}
                </span>
              )}
            </div>
          </div>
        </header>
        <nav className="profile-tabs" aria-label="Profile sections">
          <span aria-current="page">Overview</span>
        </nav>
        <div className="profile-columns">
          <div className="col gap-16">
            <section className="card profile-panel">
              <h3>About</h3>
              <p className="profile-bio">
                {p.about || 'Add a short bio so your team can get to know you.'}
              </p>
              <Details
                rows={[
                  ['Reporting Manager', manager?.name || 'Not assigned'],
                  ['Employee ID', me.employee_code],
                  ['Login username', me.username],
                  ['Joining Date', date(p.join_date)],
                  ['Employment Type', p.employment_type],
                  ['Working place', p.work_place || 'Not assigned'],
                  ['Work Location', p.location],
                  ['Date of Birth', date(p.dob)],
                  ['Address', p.address],
                  ['Emergency', p.emergency_contact],
                ]}
              />
            </section>
            <section className="card profile-panel">
              <h3>Skills</h3>
              <div className="row wrap gap-6 mt-12">
                {skills.length ? (
                  skills.map((s, i) => (
                    <span className="profile-skill" key={i}>
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="small muted">No skills added</span>
                )}
              </div>
            </section>
            <section className="card profile-panel">
              <h3>Certifications</h3>
              {p.certifications?.length ? (
                p.certifications.map((c, i) => (
                  <div className="profile-cert" key={i}>
                    <CheckCircle2 className="green" size={17} />
                    <div className="grow">
                      {c.name}
                      {c.issuer && <span className="muted"> · {c.issuer}</span>}
                    </div>
                    {c.issued && <small className="muted">Issued {date(c.issued)}</small>}
                  </div>
                ))
              ) : (
                <p className="small muted mt-12">No certifications added</p>
              )}
            </section>
          </div>
          <div className="col gap-16">
            <section className="card profile-panel">
              <h3>Organization Structure</h3>
              <div className="profile-org">
                {manager && (
                  <>
                    <div className="profile-org-node">
                      <Person person={manager} />
                    </div>
                    <span className="profile-org-line" />
                  </>
                )}
                <div className="profile-org-node current">
                  <Person person={me} />
                </div>
                {!!reports.length && (
                  <>
                    <span className="profile-org-line" />
                    <div className="row wrap gap-6 center">
                      {reports.slice(0, 4).map((u) => (
                        <div className="profile-org-node" key={u.id}>
                          <Person person={u} />
                        </div>
                      ))}
                    </div>
                    {reports.length > 4 && (
                      <p className="small muted mt-8">+{reports.length - 4} more</p>
                    )}
                  </>
                )}
              </div>
            </section>
            <section className="card profile-panel">
              <h3>Login details</h3>
              <Link to="/profile/password" className="link small">
                Change password
              </Link>
              <Details
                rows={[
                  ['Employee ID', me.employee_code],
                  ['Login username', me.username],
                  ['Work email', me.email],
                  ['Password', '••••••••'],
                ]}
              />
              <p className="profile-login-note">
                <Lock size={14} />
                Use Change password to update your password. An administrator manages other login
                details.
              </p>
            </section>
            <section className="card profile-panel">
              <h3>Team ({team.length})</h3>
              {team.length ? (
                team.map((u) => (
                  <div className="profile-team-row" key={u.id}>
                    <Person person={u} />
                  </div>
                ))
              ) : (
                <p className="small muted mt-12">No colleagues in your vertical yet.</p>
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ProfileEditor() {
  const { me, users, toast, loadBoot } = useApp(),
    { navigate } = useRouter(),
    photoRef = useRef(null);
  const p = me.profile || {},
    canEmployment = true;
  const [form, setForm] = useState(() => ({
    name: me.name,
    title: me.title || '',
    phone: me.phone || '',
    color: me.color,
    ...Object.fromEntries(
      [...personal, ...employment].map((key) => [
        key,
        key === 'certifications' ? p[key] || [] : valueOrBlank(p[key]),
      ]),
    ),
  }));
  const [saving, setSaving] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState('');
  const set = (key) => (e) => setForm((v) => ({ ...v, [key]: e.target.value }));
  const field = (key, label, type = 'text', readOnly = false) => (
    <Field label={label} htmlFor={'profile-' + key} key={key}>
      <input
        id={'profile-' + key}
        className="input"
        type={type}
        readOnly={readOnly}
        maxLength={key === 'name' || key === 'title' ? 120 : 1000}
        required={key === 'name'}
        value={form[key] || ''}
        onChange={set(key)}
      />
    </Field>
  );
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/me', {
        name: form.name,
        title: form.title,
        phone: form.phone,
        color: form.color,
        profile: Object.fromEntries(
          [...personal, ...(canEmployment ? employment : [])].map((key) => [key, form[key]]),
        ),
      });
      await loadBoot();
      toast('Profile saved', 'success');
      navigate('/profile');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="profile-page">
      <Link className="link row gap-6 mb-16" to="/profile">
        <ArrowLeft size={16} />
        Back to profile
      </Link>
      <div className="page-head">
        <div>
          <h1>Edit Profile</h1>
          <p className="sub">Update your personal profile and contact information.</p>
        </div>
      </div>
      <form onSubmit={save} className="card profile-editor">
        {error && (
          <div className="alert error mb-16" role="alert">
            {error}
          </div>
        )}
        <div className="row gap-12 mb-16">
          <Avatar name={form.name} color={form.color} photo={form.photo || me.photo} size={72} />
          <button
            type="button"
            className="btn"
            disabled={saving || reading}
            onClick={() => photoRef.current?.click()}
          >
            <Camera size={15} />
            Change photo
          </button>
          <input
            ref={photoRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files[0];
              e.target.value = '';
              setReading(true);
              setError('');
              try {
                const photo = await readPhoto(file);
                if (photo) setForm((v) => ({ ...v, photo }));
              } catch (e) {
                setError(e.message);
              } finally {
                setReading(false);
              }
            }}
          />
        </div>
        <div className="form-grid">
          {field('name', 'Full name')}
          {field('title', 'Job title', 'text', !canEmployment)}
          {field('phone', 'Phone', 'tel')}
          {field('dob', 'Date of birth', 'date')}
          <Field label="About" htmlFor="profile-about" className="full">
            <textarea
              id="profile-about"
              className="textarea"
              rows={3}
              maxLength={4000}
              value={form.about}
              onChange={set('about')}
            />
          </Field>
          <Field label="Address" htmlFor="profile-address" className="full">
            <textarea
              id="profile-address"
              className="textarea"
              maxLength={1000}
              value={form.address}
              onChange={set('address')}
            />
          </Field>
          {field('emergency_contact', 'Emergency contact')}
          {field('skills', 'Skills (comma separated)')}
          <div className="full">
            <h3>Certifications</h3>
            {form.certifications.map((cert, i) => (
              <div className="profile-cert-edit" key={i}>
                {[
                  ['name', 'Certification name', 'text'],
                  ['issuer', 'Issuer', 'text'],
                  ['issued', 'Issue date', 'date'],
                ].map(([key, label, type]) => (
                  <input
                    key={key}
                    aria-label={label + ' ' + (i + 1)}
                    className="input"
                    type={type}
                    required={key === 'name'}
                    maxLength={200}
                    value={cert[key] || ''}
                    onChange={(e) =>
                      setForm((v) => ({
                        ...v,
                        certifications: v.certifications.map((c, j) =>
                          j === i ? { ...c, [key]: e.target.value } : c,
                        ),
                      }))
                    }
                  />
                ))}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={'Remove certification ' + (i + 1)}
                  onClick={() =>
                    setForm((v) => ({
                      ...v,
                      certifications: v.certifications.filter((_, j) => j !== i),
                    }))
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn sm mt-8"
              disabled={form.certifications.length >= 30}
              onClick={() =>
                setForm((v) => ({
                  ...v,
                  certifications: [...v.certifications, { name: '', issuer: '', issued: '' }],
                }))
              }
            >
              <Plus size={14} />
              Add certification
            </button>
          </div>
          <div className="form-section">
            Employment details {canEmployment ? '' : '· read-only'}
          </div>
          {employment
            .filter((k) => k !== 'manager_id')
            .map((key) =>
              field(
                key,
                {
                  department: 'Department',
                  employment_type: 'Employment type',
                  work_place: 'Working place',
                  location: 'Work location',
                  join_date: 'Joining date',
                }[key],
                key === 'join_date' ? 'date' : 'text',
                !canEmployment,
              ),
            )}
          <Field label="Reporting manager" htmlFor="profile-manager">
            <select
              id="profile-manager"
              className="select"
              disabled={!canEmployment}
              value={form.manager_id}
              onChange={set('manager_id')}
            >
              <option value="">Not assigned</option>
              {users
                .filter((u) => u.id !== me.id)
                .map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-section">Login details</div>
          {[
            ['Employee ID', me.employee_code],
            ['Login username', me.username],
            ['Work email', me.email],
          ].map(([label, value]) => (
            <Field label={label} key={label}>
              <input className="input" readOnly value={value || ''} />
            </Field>
          ))}
          <p className="small muted full">
            Your employee ID stays fixed. An administrator manages account details.
          </p>
        </div>
        <div className="row gap-8 mt-16">
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={() => navigate('/profile')}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={saving || reading}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProfilePassword({ forced = false }) {
  const { toast, loadBoot } = useApp(),
    { navigate } = useRouter();
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [again, setAgain] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="card profile-password"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        if (next !== again) return setError('Passwords do not match');
        setBusy(true);
        try {
          await api.post('/me/password', { current, next });
          await loadBoot();
          toast('Password changed', 'success');
          if (!forced) navigate('/profile');
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{forced ? 'Set your password' : 'Change password'}</h2>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!forced && (
        <Field label="Current password">
          <input
            className="input"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
      )}
      <Field label="New password">
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      <Field label="Confirm password">
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </Field>
      <button className="btn primary mt-16" disabled={busy}>
        Save password
      </button>
      {!forced && (
        <Link className="btn mt-16" to="/profile">
          Cancel
        </Link>
      )}
    </form>
  );
}
