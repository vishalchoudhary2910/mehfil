// Shared helpers for the extended API surface (teams, payouts, follows, match).
// Mirrors the logic in worker/index.js so extra.js can stay a leaf module.

export const HOST_FEE_PCT = 5;   // plan: 5% host fee
export const ARTIST_FEE_PCT = 6; // plan: 5-8% artist fee
export const ADVANCE_PCT = 40;   // advance held in escrow until the event

export const json = (data, init = {}) =>
  Response.json(data, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init.headers || {}) },
  });

export const err = (status, error) => json({ error }, { status });

export const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};

export const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// The operator console can read hosts' contact details and run paid engines, so
// production defaults to closed. Set LEAD_OWNER_EMAILS to the operator's
// account(s); loopback development stays frictionless without configuration.
export function isWorkspaceOwner(env, me) {
  const allowed = String(env.LEAD_OWNER_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length) return allowed.includes(String(me?.email || "").toLowerCase());
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(String(env.APP_ORIGIN || ""));
}

export const uid = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

export const shapeArtist = (a) => ({
  ...a,
  sub_skills: parseJson(a.sub_skills, []),
  languages: parseJson(a.languages, []),
  verified: !!a.verified,
  founding_artist: !!a.founding_artist,
});

// Same first-sign-in persona adoption as index.js (demo seed "You" row).
export async function resolveUser(db, fbUser) {
  let row = await db
    .prepare("SELECT * FROM users WHERE auth_sub = ?")
    .bind(fbUser.sub)
    .first();
  if (row) return row;
  const adopted = await db
    .prepare(
      "UPDATE users SET auth_sub = ?, name = COALESCE(?, name), email = COALESCE(?, email) WHERE auth_sub = 'seed:host:me' RETURNING *"
    )
    .bind(fbUser.sub, fbUser.name || null, fbUser.email || null)
    .first();
  if (adopted) return adopted;
  row = {
    id: uid("u"),
    auth_sub: fbUser.sub,
    name: fbUser.name || "Host",
    email: fbUser.email || null,
    city: null,
    kind: "host",
  };
  await db
    .prepare("INSERT INTO users (id, auth_sub, name, email, city, kind) VALUES (?,?,?,?,?,?)")
    .bind(row.id, row.auth_sub, row.name, row.email, row.city, row.kind)
    .run();
  return row;
}

// Active team membership rows for a user across a shared profile, if any.
export async function teamForProfile(db, profileId) {
  return db
    .prepare("SELECT * FROM teams WHERE profile_id = ?")
    .bind(profileId)
    .first();
}

// role of user on the team that owns this shared profile, or null.
export async function teamRoleForProfile(db, profileId, userId) {
  const row = await db
    .prepare(
      `SELECT tm.role FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE t.profile_id = ? AND tm.user_id = ? AND tm.status = 'active'`
    )
    .bind(profileId, userId)
    .first();
  return row?.role || null;
}
