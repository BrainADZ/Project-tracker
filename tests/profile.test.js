import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { migrate, seedBasics } from "../shared/setup.js";
import { handle } from "../shared/api.js";
import { loadUser } from "../shared/access.js";
import { ensureUserIdentity } from "../shared/profile.js";

test("existing version 14 accounts retain login and contact data through the profile upgrade", () => {
  const db = openDb(":memory:");
  migrate(db);
  seedBasics(db);
  try {
    const id = db.run(
      "INSERT INTO users(name,email,password_hash,phone) VALUES ('Existing Person','existing@test.local','preserved-hash','123456789')",
    ).id;
    db.exec(
      "DROP INDEX idx_users_username; DROP INDEX idx_users_employee_code; ALTER TABLE users DROP COLUMN username; ALTER TABLE users DROP COLUMN employee_code; ALTER TABLE users DROP COLUMN profile_json;",
    );
    db.run("UPDATE settings SET value='14' WHERE key='schema_version'");
    migrate(db);
    const row = db.get("SELECT * FROM users WHERE id=?", id);
    assert.equal(row.email, "existing@test.local");
    assert.equal(row.password_hash, "preserved-hash");
    assert.equal(row.phone, "123456789");
    const identity = ensureUserIdentity(db, id);
    assert.equal(identity.employee_code, "BZ001");
    assert.equal(identity.username, "ExistingBZ001");
    migrate(db);
    assert.equal(ensureUserIdentity(db, id).username, "ExistingBZ001");
  } finally {
    db.close();
  }
});

test("profile edits preserve fixed login IDs and members cannot change credentials", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedBasics(db);
  try {
    const admin = db.run(
      "INSERT INTO users(name,email,role) VALUES ('CEO','ceo@test.local','admin')",
    ).id;
    const member = db.run(
      "INSERT INTO users(name,email,role,must_change_password) VALUES ('Neha Sharma','neha@test.local','member',1)",
    ).id;
    const vertical = db.get("SELECT id FROM verticals WHERE code='MKT'").id;
    db.run(
      "INSERT INTO user_verticals(user_id,vertical_id,level) VALUES (?,?,'member')",
      member,
      vertical,
    );
    const services = {
      today: () => "2026-11-03",
      now: () => "2026-11-03T04:00:00Z",
      hashPassword: async (value) => "hashed:" + value,
      verifyPassword: async () => true,
    };
    const call = (user, method, path, body = {}) =>
      handle(
        { db, user: loadUser(db, user), body, query: {}, services },
        method,
        path,
      );
    let me = (await call(member, "GET", "/bootstrap")).me;
    assert.equal(me.username, "NehaBZM002");
    assert.equal(me.employee_code, "BZ002");
    assert.equal(me.can_manage_credentials, false);
    me = await call(member, "PATCH", "/me", {
      name: "Neha Changed",
      phone: "123456789",
      profile: {
        about: "Frontend developer",
        skills: "React, CSS",
        certifications: [
          {
            name: "React fundamentals",
            issuer: "Academy",
            issued: "2026-10-01",
          },
        ],
        address: "Bengaluru",
        dob: "1998-06-01",
      },
    });
    assert.equal(me.username, "NehaBZM002");
    assert.equal(me.profile.about, "Frontend developer");
    assert.equal(me.profile.certifications[0].issuer, "Academy");
    for (const body of [
      { email: "changed@test.local" },
      { username: "newLogin" },
      { password: "newPassword123" },
      { profile: { manager_id: admin } },
      { profile: { employment_type: "Full-time" } },
    ])
      await assert.rejects(
        call(member, "PATCH", "/me", body),
        (e) => e.status === 403,
      );
    await assert.rejects(
      call(member, "POST", "/me/password", { next: "newPassword123" }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      call(member, "PATCH", "/admin/users/" + member, {
        email: "changed@test.local",
      }),
      (e) => e.status === 403,
    );
    await call(admin, "PATCH", "/admin/users/" + member, {
      email: "updated@test.local",
      username: "NehaBZM002New",
      password: "NewPass123",
    });
    me = (await call(member, "GET", "/bootstrap")).me;
    assert.equal(me.email, "updated@test.local");
    assert.equal(me.username, "NehaBZM002New");
    assert.equal(me.must_change_password, false);
    assert.equal(me.employee_code, "BZ002");
    const hash = db.get(
      "SELECT password_hash FROM users WHERE id=?",
      member,
    ).password_hash;
    assert.equal(hash, "hashed:NewPass123");
    await call(admin, "PATCH", "/admin/users/" + member, {
      profile: {
        manager_id: admin,
        department: "Development",
        employment_type: "Full-time",
        join_date: "2025-06-01",
      },
    });
    const boot = await call(member, "GET", "/bootstrap");
    assert.equal(boot.me.profile.manager_id, admin);
    assert.equal(boot.me.profile.employment_type, "Full-time");
    assert.equal(boot.users.find((u) => u.id === member).manager_id, admin);
    assert.equal(
      boot.users.some(
        (u) => u.profile_json !== undefined || u.profile !== undefined,
      ),
      false,
      "Directory does not reveal private profile fields",
    );
    await call(admin, "POST", "/me/password", { next: "AdminPass123" });
    await assert.rejects(
      call(member, "PATCH", "/me", {
        profile: { photo: "data:image/svg+xml;base64,PHN2Zz4=" },
      }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      call(member, "PATCH", "/me", { profile: { certifications: "fake" } }),
      (e) => e.status === 400,
    );
    // Re-running migration preserves the login identity and personal data.
    migrate(db);
    assert.equal(ensureUserIdentity(db, member).username, "NehaBZM002New");
    assert.equal(
      (await call(member, "GET", "/bootstrap")).me.profile.about,
      "Frontend developer",
    );
  } finally {
    db.close();
  }
});
