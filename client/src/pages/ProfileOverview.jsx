import { useRef, useState } from "react";
import {
  Pencil,
  Camera,
  Mail,
  Phone,
  CalendarDays,
  MapPin,
  Briefcase,
  UserRound,
  BadgeCheck,
  CheckCircle2,
  Lock,
  Plus,
  X,
} from "lucide-react";
import { useApp } from "../store.jsx";
import { api } from "../api.js";
import { Field, Avatar, Modal, VChip } from "../ui.jsx";
import { fmtDate } from "../format.js";

const COLORS = [
  "#1f2b7b",
  "#e31b3b",
  "#1a6df0",
  "#1fa855",
  "#f2a600",
  "#7c5cfc",
  "#ef4778",
  "#1fb2d6",
  "#0f766e",
  "#b45309",
];
const date = (value) => (value ? fmtDate(value.slice(0, 10)) : "Not provided");

export default function Profile({ forced = false }) {
  const { me, users, verticals, toast, loadBoot } = useApp();
  const [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [f, setF] = useState({}),
    [pw, setPw] = useState({ next: "", again: "" });
  const photoInput = useRef(null);
  const p = me.profile || {},
    admin = !!me.can_manage_credentials;
  const manager = users.find((u) => u.id === p.manager_id);
  const reports = users.filter((u) => u.manager_id === me.id);
  const team = reports.length
    ? reports
    : users.filter(
        (u) =>
          u.id !== me.id &&
          Object.keys(u.access || {}).some((id) => me.access?.[id]),
      );
  const set = (key) => (e) =>
    setF((prev) => ({ ...prev, [key]: e.target.value }));
  const open = () => {
    setError("");
    setF({
      name: me.name,
      title: me.title || "",
      phone: me.phone || "",
      color: me.color,
      email: me.email,
      username: me.username || "",
      password: "",
      about: p.about || "",
      address: p.address || "",
      dob: p.dob || "",
      emergency_contact: p.emergency_contact || "",
      skills: p.skills || "",
      certifications: p.certifications || [],
      department: p.department || "",
      employment_type: p.employment_type || "",
      work_place: p.work_place || "",
      location: p.location || "",
      join_date: p.join_date || "",
      manager_id: p.manager_id || "",
    });
    setEditing(true);
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const profile = Object.fromEntries(
        [
          "about",
          "address",
          "dob",
          "emergency_contact",
          "skills",
          "certifications",
          ...(admin
            ? [
                "department",
                "employment_type",
                "work_place",
                "location",
                "join_date",
                "manager_id",
              ]
            : []),
        ].map((k) => [k, f[k]]),
      );
      await api.patch("/me", {
        name: f.name,
        title: f.title,
        phone: f.phone,
        color: f.color,
        profile,
      });
      if (
        admin &&
        (f.email !== me.email || f.username !== me.username || f.password)
      )
        await api.patch("/admin/users/" + me.id, {
          email: f.email,
          username: f.username,
          ...(f.password ? { password: f.password } : {}),
        });
      await loadBoot();
      setEditing(false);
      toast("Profile saved", "success");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const changePhoto = async (file) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 1024 * 1024
    ) {
      toast("Choose a PNG, JPEG or WebP photo under 1 MB", "error");
      return;
    }
    setSaving(true);
    try {
      const photo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read photo"));
        reader.readAsDataURL(file);
      });
      await api.patch("/me", { profile: { photo } });
      await loadBoot();
      toast("Photo updated", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };
  if (forced)
    return admin ? (
      <div className="profile-password">
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (pw.next !== pw.again) return setError("Passwords do not match");
            setSaving(true);
            try {
              await api.post("/me/password", { next: pw.next });
              await loadBoot();
              toast("Password changed", "success");
            } catch (e) {
              setError(e.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <h2 className="mb-16">Set your password</h2>
          {error && <div className="alert error mb-12">{error}</div>}
          <Field label="New password">
            <input
              className="input"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </Field>
          <Field label="Confirm new password" className="mt-12">
            <input
              className="input"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              value={pw.again}
              onChange={(e) => setPw({ ...pw, again: e.target.value })}
            />
          </Field>
          <button className="btn primary mt-16" disabled={saving}>
            Save password
          </button>
        </form>
      </div>
    ) : null;
  const person = (u, small = false) => (
    <div className={"profile-person " + (small ? "small" : "")}>
      <Avatar name={u.name} color={u.color} size={small ? 28 : 34} />
      <div>
        <b>{u.name}</b>
        <span>{u.title || "Team member"}</span>
      </div>
    </div>
  );
  const details = [
    [UserRound, "Reporting Manager", manager?.name || "Not assigned"],
    [BadgeCheck, "Employee ID", me.employee_code || "Not assigned"],
    [UserRound, "Login username", me.username || "Not assigned"],
    [CalendarDays, "Joining Date", date(p.join_date)],
    [Briefcase, "Employment Type", p.employment_type || "Not provided"],
    [Briefcase, "Working place", p.work_place || "Not assigned"],
    [MapPin, "Work Location", p.location || "Not provided"],
    [CalendarDays, "Date of Birth", date(p.dob)],
    [MapPin, "Address", p.address || "Not provided"],
    [Phone, "Emergency", p.emergency_contact || "Not provided"],
  ];
  const skills = (p.skills || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="profile-page">
      <section className="card profile-shell">
        <header className="profile-header">
          <div className="profile-photo">
            <div className="profile-photo-wrap">
              {p.photo ? (
                <img src={p.photo} alt={me.name} />
              ) : (
                <Avatar name={me.name} color={me.color} size={102} />
              )}
              <span className="profile-active" title="Active account" />
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={saving}
              onClick={() => photoInput.current?.click()}
            >
              <Camera size={14} />
              Change photo
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                changePhoto(e.target.files[0]);
                e.target.value = "";
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
                <p className="muted mt-4">{me.title || "Team member"}</p>
              </div>
              <button className="btn primary" onClick={open}>
                <Pencil size={15} />
                Edit Profile
              </button>
            </div>
            <div className="row wrap gap-8 mt-12">
              {verticals.map((v) => (
                <VChip
                  key={v.id}
                  name={v.short + (p.department ? " · " + p.department : "")}
                  color={v.color}
                  small
                />
              ))}
              {p.employment_type && (
                <span className="badge b-blue">{p.employment_type}</span>
              )}
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
                {p.about || "Add a short bio so your team can get to know you."}
              </p>
              <dl className="profile-details">
                {details.map(([Icon, label, value]) => (
                  <div key={label}>
                    <dt>
                      <Icon size={14} />
                      {label}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
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
                    {c.issued && (
                      <small className="muted">Issued {date(c.issued)}</small>
                    )}
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
                      {person(manager, true)}
                    </div>
                    <span className="profile-org-line" />
                  </>
                )}
                <div className="profile-org-node current">
                  {person(me, true)}
                </div>
                {reports.length > 0 && (
                  <>
                    <span className="profile-org-line" />
                    <div className="row wrap gap-6 center">
                      {reports.slice(0, 4).map((u) => (
                        <div className="profile-org-node" key={u.id}>
                          {person(u, true)}
                        </div>
                      ))}
                    </div>
                    <p className="xs muted mt-8">
                      Colleagues in your vertical
                      {team.length > 4
                        ? " · +" + (team.length - 4) + " more"
                        : ""}
                    </p>
                  </>
                )}
              </div>
            </section>
            <section className="card profile-panel">
              <h3>Login details</h3>
              <dl className="profile-details">
                <div>
                  <dt>Login username</dt>
                  <dd>{me.username}</dd>
                </div>
                <div>
                  <dt>Work email</dt>
                  <dd>{me.email}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd>••••••••</dd>
                </div>
              </dl>
              <p className="profile-login-note">
                <Lock size={14} />
                {admin
                  ? "CEO / IT administrators can manage login details using Edit Profile and Team & Access."
                  : "Login details are managed by the CEO / IT team. Contact them for changes."}
              </p>
            </section>
            <section className="card profile-panel">
              <h3>Team ({team.length})</h3>
              {team.length ? (
                team.map((u) => (
                  <div className="profile-team-row" key={u.id}>
                    {person(u)}
                  </div>
                ))
              ) : (
                <p className="small muted mt-12">
                  No colleagues in your vertical yet.
                </p>
              )}
            </section>
          </div>
        </div>
      </section>
      {editing && (
        <Modal
          title="Edit Profile"
          size="wide"
          onClose={() => !saving && setEditing(false)}
          footer={
            <>
              <button
                className="btn"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                form="profile-edit-form"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </>
          }
        >
          <form
            id="profile-edit-form"
            className="modal-body form-grid"
            onSubmit={save}
          >
            {error && (
              <div className="alert error full" role="alert">
                {error}
              </div>
            )}
            <Field label="Full name" htmlFor="pr-name">
              <input
                id="pr-name"
                className="input"
                required
                maxLength={120}
                value={f.name}
                onChange={set("name")}
              />
            </Field>
            <Field label="Job title" htmlFor="pr-title">
              <input
                id="pr-title"
                className="input"
                maxLength={120}
                value={f.title}
                onChange={set("title")}
              />
            </Field>
            <Field label="Phone" htmlFor="pr-phone">
              <input
                id="pr-phone"
                className="input"
                maxLength={40}
                value={f.phone}
                onChange={set("phone")}
              />
            </Field>
            <Field label="Date of birth" htmlFor="pr-dob">
              <input
                id="pr-dob"
                className="input"
                type="date"
                value={f.dob}
                onChange={set("dob")}
              />
            </Field>
            <Field label="About" className="full" htmlFor="pr-about">
              <textarea
                id="pr-about"
                className="textarea"
                rows={3}
                maxLength={4000}
                value={f.about}
                onChange={set("about")}
              />
            </Field>
            <Field label="Address" className="full" htmlFor="pr-address">
              <textarea
                id="pr-address"
                className="textarea"
                maxLength={1000}
                value={f.address}
                onChange={set("address")}
              />
            </Field>
            <Field label="Emergency contact" htmlFor="pr-emergency">
              <input
                id="pr-emergency"
                className="input"
                maxLength={1000}
                value={f.emergency_contact}
                onChange={set("emergency_contact")}
              />
            </Field>
            <Field label="Skills (comma separated)" htmlFor="pr-skills">
              <input
                id="pr-skills"
                className="input"
                maxLength={1000}
                value={f.skills}
                onChange={set("skills")}
              />
            </Field>
            <div className="full">
              <h3 className="mb-8">Certifications</h3>
              {f.certifications.map((c, i) => (
                <div className="profile-cert-edit" key={i}>
                  <input
                    className="input"
                    aria-label={"Certification " + (i + 1)}
                    placeholder="Certification name"
                    required
                    maxLength={200}
                    value={c.name}
                    onChange={(e) =>
                      setF({
                        ...f,
                        certifications: f.certifications.map((v, j) =>
                          j === i ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <input
                    className="input"
                    aria-label={"Issuer " + (i + 1)}
                    placeholder="Issuer"
                    maxLength={200}
                    value={c.issuer}
                    onChange={(e) =>
                      setF({
                        ...f,
                        certifications: f.certifications.map((v, j) =>
                          j === i ? { ...v, issuer: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <input
                    className="input"
                    aria-label={"Issue date " + (i + 1)}
                    type="date"
                    value={c.issued || ""}
                    onChange={(e) =>
                      setF({
                        ...f,
                        certifications: f.certifications.map((v, j) =>
                          j === i ? { ...v, issued: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={"Remove certification " + (i + 1)}
                    onClick={() =>
                      setF({
                        ...f,
                        certifications: f.certifications.filter(
                          (_, j) => i !== j,
                        ),
                      })
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                className="btn sm mt-8"
                type="button"
                disabled={f.certifications.length >= 30}
                onClick={() =>
                  setF({
                    ...f,
                    certifications: [
                      ...f.certifications,
                      { name: "", issuer: "", issued: "" },
                    ],
                  })
                }
              >
                <Plus size={14} />
                Add certification
              </button>
            </div>
            <Field label="Avatar colour" className="full">
              <div className="row wrap gap-6">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={"swatch " + (f.color === c ? "on" : "")}
                    style={{ background: c }}
                    aria-label={"Colour " + c}
                    onClick={() => setF({ ...f, color: c })}
                  />
                ))}
              </div>
            </Field>
            {admin && (
              <>
                <div className="form-section">Employment details</div>
                {[
                  ["department", "Department"],
                  ["employment_type", "Employment type"],
                  ["work_place", "Working place"],
                  ["location", "Work location"],
                ].map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={"pr-" + key}>
                    <input
                      id={"pr-" + key}
                      className="input"
                      maxLength={1000}
                      value={f[key]}
                      onChange={set(key)}
                    />
                  </Field>
                ))}
                <Field label="Joining date" htmlFor="pr-joining">
                  <input
                    id="pr-joining"
                    className="input"
                    type="date"
                    value={f.join_date}
                    onChange={set("join_date")}
                  />
                </Field>
                <Field label="Reporting manager" htmlFor="pr-manager">
                  <select
                    id="pr-manager"
                    className="select"
                    value={f.manager_id}
                    onChange={set("manager_id")}
                  >
                    <option value="">Not assigned</option>
                    {users
                      .filter((u) => u.id !== me.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
            <div className="form-section">
              Login details ·{" "}
              {admin ? "CEO / IT access" : "Managed by CEO / IT"}
            </div>
            <Field label="Work email" htmlFor="pr-email">
              <input
                id="pr-email"
                className="input"
                type="email"
                required
                value={f.email}
                readOnly={!admin}
                onChange={set("email")}
              />
            </Field>
            <Field label="Login username" htmlFor="pr-username">
              <input
                id="pr-username"
                className="input"
                required
                value={f.username}
                readOnly={!admin}
                maxLength={120}
                onChange={set("username")}
              />
            </Field>
            {admin ? (
              <Field label="New password (optional)" htmlFor="pr-password">
                <input
                  id="pr-password"
                  className="input"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={f.password}
                  onChange={set("password")}
                  placeholder="Leave blank to keep current password"
                />
              </Field>
            ) : (
              <p className="full small muted">
                Your email, login username and password can only be changed by
                the CEO / IT team.
              </p>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
