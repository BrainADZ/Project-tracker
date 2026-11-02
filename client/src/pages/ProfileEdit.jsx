import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useRouter } from '../router.jsx';
import { api } from '../api.js';
import { Field } from '../ui.jsx';

const DEPARTMENTS = ['Admin', 'Business Development', 'Client Servicing', 'Creative', 'Design', 'Events', 'Finance', 'HR', 'IT', 'Leadership', 'Marketing', 'Operations', 'Sales', 'Technology'];
const BRANCHES = ['Bengaluru', 'Delhi NCR', 'Mumbai'];
const optionList = (items) => items.map((item) => <option key={item} value={item}>{item}</option>);
const splitName = (name) => { const [first, ...last] = (name || '').trim().split(/\s+/); return { first_name: first || '', last_name: last.join(' ') }; };

export default function ProfileEdit() {
  const { me, users, toast, loadBoot } = useApp();
  const { navigate } = useRouter();
  const [form, setForm] = useState(() => ({
    ...splitName(me.name), email: me.email, phone: me.phone || '', title: me.title || '',
    employee_id: `BZ${String(me.id).padStart(3, '0')}`,
    ...(me.profile || {}),
  }));
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
  const input = (key, label, { type = 'text', required = false, hint, placeholder, ...props } = {}) => <Field label={label} htmlFor={key} hint={hint}><input id={key} className="input" type={type} required={required} placeholder={placeholder} value={form[key] || ''} onChange={set(key)} {...props} /></Field>;
  const select = (key, label, items, placeholder = 'Select', required = false) => <Field label={label} htmlFor={key}><select id={key} className="select" required={required} value={form[key] || ''} onChange={set(key)}><option value="">{placeholder}</option>{optionList(items)}</select></Field>;
  const save = async (event) => {
    event.preventDefault();
    const profile = { ...form };
    delete profile.email;
    delete profile.phone;
    delete profile.title;
    setSaving(true);
    try {
      await api.patch('/me', { name: [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' '), email: form.email, phone: form.phone, title: form.designation || form.title, profile });
      await loadBoot();
      toast('Profile updated', 'success');
      navigate('/profile');
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  return <div className="profile-edit-page">
    <button type="button" className="link profile-edit-back" onClick={() => navigate('/profile')}><ArrowLeft size={17} /> Back to profile</button>
    <div className="page-head"><div><h1>Edit {me.name}</h1><div className="sub">Update your employee information.</div></div></div>
    <form onSubmit={save} className="profile-edit-form">
      <section className="card profile-edit-section"><h2>Personal</h2><div className="profile-edit-grid">
        {input('first_name', 'First name *', { required: true })}
        {input('last_name', 'Last name')}
        {input('email', 'Work email *', { type: 'email', required: true })}
        {select('gender', 'Gender', ['Female', 'Male', 'Other'])}
        {input('dob', 'Date of birth', { type: 'date' })}
        {input('phone', 'Phone', { type: 'tel' })}
      </div></section>
      <section className="card profile-edit-section"><h2>Job</h2><div className="profile-edit-grid">
        {input('employee_id', 'Employee ID', { hint: 'Your unique company ID. Leave blank to use BZ + your employee number.', placeholder: `BZ${String(me.id).padStart(3, '0')}` })}
        {select('vertical', 'Vertical', ['BrainADZ Live', 'BrainADZ Marketing', 'BrainADZ Exhibits', 'Corporate'])}
        {select('department', 'Department', DEPARTMENTS)}
        {input('designation', 'Designation')}
        {select('grade', 'Grade', ['Executive', 'Senior', 'Manager', 'Head', 'CXO'])}
        <Field label="Reporting manager" htmlFor="reporting_manager_id"><select id="reporting_manager_id" className="select" value={form.reporting_manager_id || ''} onChange={set('reporting_manager_id')}><option value="">None</option>{users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name} · BZ{String(u.id).padStart(3, '0')}</option>)}</select></Field>
        {select('employment_type', 'Employment type', ['Full-time', 'Part-time', 'Contract', 'Intern'])}
        {select('working_place', 'Working place', ['Not assigned', 'On Site (Office)', 'WFH (Work from home)'])}
        {select('assigned_branch', 'Assigned branch *', BRANCHES, 'Select branch', true)}
        {input('joining_date', 'Joining date *', { type: 'date', required: true })}
      </div><p className="small muted mt-16">WFH allows remote work. On Site uses the assigned branch when office location checks are enabled.</p></section>
      <section className="card profile-edit-section"><h2>Pay &amp; statutory</h2><div className="profile-edit-grid">
        {input('annual_ctc', 'Annual CTC (₹)', { type: 'number', min: '0', step: '0.01' })}
        {input('monthly_tds', 'Monthly TDS (₹)', { type: 'number', min: '0', step: '0.01', placeholder: 'Leave blank to estimate' })}
        {input('pan', 'PAN')}
        {input('uan', 'UAN')}
        {input('bank_name', 'Bank name')}
        {input('account_number', 'Account number')}
        {input('ifsc', 'IFSC')}
      </div></section>
      <section className="card profile-edit-section"><h2>Profile</h2><div className="profile-edit-grid">
        <Field label="Address" htmlFor="address"><textarea id="address" className="textarea" rows={3} value={form.address || ''} onChange={set('address')} /></Field>
        {input('emergency_contact', 'Emergency contact')}
        {input('skills', 'Skills', { placeholder: 'Comma separated' })}
        <Field label="About" htmlFor="about" className="profile-edit-wide"><textarea id="about" className="textarea" rows={4} value={form.about || ''} onChange={set('about')} /></Field>
      </div></section>
      <div className="profile-edit-actions"><button type="button" className="btn" onClick={() => navigate('/profile')}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button></div>
    </form>
  </div>;
}
