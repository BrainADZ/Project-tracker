import { useRef, useState } from 'react';
import { BriefcaseBusiness, Camera, CalendarDays, Mail, Pencil, Phone, ShieldCheck } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import { Avatar, Field, VChip } from '../ui.jsx';

export default function Profile({ forced = false }) {
  const { me, users, verticals, toast, loadBoot } = useApp();
  const { navigate } = useRouter();
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwErr, setPwErr] = useState('');
  const photoInput = useRef(null);

  const save = async (changes) => {
    setSaving(true);
    try {
      await api.patch('/me', changes);
      await loadBoot();
      toast('Profile updated', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const changePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 220000) return toast('Choose a JPG, PNG or WebP photo under 220 KB', 'error');
    const reader = new FileReader();
    reader.onload = () => save({ photo: reader.result });
    reader.onerror = () => toast('Could not read this photo', 'error');
    reader.readAsDataURL(file);
  };
  const savePassword = async (event) => {
    event.preventDefault();
    setPwErr('');
    if (pw.next !== pw.again) return setPwErr('The two new passwords do not match');
    try {
      await api.post('/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', again: '' });
      toast('Password changed', 'success');
      await loadBoot();
    } catch (error) { setPwErr(error.message); }
  };
  if (forced) return <form className="card" style={{ maxWidth: 460, margin: '40px auto' }} onSubmit={savePassword}>
    <h3>Choose your own password</h3><p className="small muted mb-16">You signed in with a temporary password. Set your own to continue.</p>
    {pwErr && <div className="alert error mb-12">{pwErr}</div>}
    <div className="col"><Field label="New password" htmlFor="pw-new" hint="At least 8 characters"><input id="pw-new" className="input" type="password" minLength={8} required autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field><Field label="New password again" htmlFor="pw-again"><input id="pw-again" className="input" type="password" minLength={8} required autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field></div>
    <button className="btn primary mt-16">Save password</button>
  </form>;

  const joinedAt = me.profile?.joining_date || me.created_at;
  const joined = joinedAt ? new Date(joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const manager = me.profile?.reporting_manager_id ? users.find((user) => user.id === Number(me.profile.reporting_manager_id))?.name : '';
  return <div className="profile-overview">
    <div className="page-head"><div><h1>My profile</h1><div className="sub">Your details at a glance.</div></div></div>
    <div className="profile-overview-top">
      <div className="profile-photo-area"><Avatar name={me.name} color={me.color} photo={me.photo} size={112} /><button type="button" className="btn profile-photo-btn" disabled={saving} onClick={() => photoInput.current?.click()}><Camera size={16} /> Change photo</button><input ref={photoInput} className="profile-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} /></div>
      <div className="profile-overview-info">
        <div className="profile-name-line"><h2>{me.name}</h2>{me.profile?.employee_id && <span className="profile-id">{me.profile.employee_id}</span>}</div>
        <p className="profile-job-title">{me.title || 'Add your job title'}</p>
        <button type="button" className="btn primary profile-edit-btn" onClick={() => navigate('/profile/edit')}><Pencil size={17} /> Edit Profile</button>
        <div className="profile-chips">{me.role === 'admin' && <span className="profile-chip"><ShieldCheck size={14} /> Admin</span>}{verticals.map((v) => <VChip key={v.id} name={v.name} color={v.color} />)}</div>
        <div className="profile-meta"><span><Mail size={17} /> {me.email}</span>{me.phone && <span><Phone size={17} /> {me.phone}</span>}{joined && <span><CalendarDays size={17} /> Joined {joined}</span>}</div>
      </div>
    </div>
    <div className="profile-overview-tab">Overview</div>
    <section className="card profile-about"><h3>About</h3><p>{me.profile?.about || (me.title ? `${me.title} at BrainADZ.` : 'Add your job title to tell your team a little about your role.')}</p><div className="profile-about-rows"><div><BriefcaseBusiness size={17} /><span>Job title</span><strong>{me.title || 'Not added'}</strong></div>{manager && <div><ShieldCheck size={17} /><span>Reports to</span><strong>{manager}</strong></div>}{me.profile?.department && <div><BriefcaseBusiness size={17} /><span>Department</span><strong>{me.profile.department}</strong></div>}<div><Mail size={17} /><span>Email</span><strong>{me.email}</strong></div><div><Phone size={17} /><span>Phone</span><strong>{me.phone || 'Not added'}</strong></div>{me.profile?.employment_type && <div><BriefcaseBusiness size={17} /><span>Employment</span><strong>{me.profile.employment_type}</strong></div>}{me.profile?.assigned_branch && <div><BriefcaseBusiness size={17} /><span>Branch</span><strong>{me.profile.assigned_branch}</strong></div>}{joined && <div><CalendarDays size={17} /><span>Joined</span><strong>{joined}</strong></div>}{verticals.length > 0 && <div><BriefcaseBusiness size={17} /><span>Teams</span><strong>{verticals.map((v) => v.name).join(', ')}</strong></div>}</div></section>
  </div>;
}
