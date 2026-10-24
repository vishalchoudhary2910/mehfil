import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers.mjs";
import {
  ensureJamSchema,
  createJam,
  listJams,
  jamDetail,
  rsvpJam,
  broadcastJam,
  cancelJam,
  runJamSweep,
  JAM_KINDS,
} from "../worker/jam.js";
import { ensureRequestSchema, runAlerts } from "../worker/requests.js";

const host = { id: "u_host", name: "Radhika", email: "radhika@example.com" };
const joiner = { id: "u_join", name: "Aman", email: "aman@example.com" };
const stranger = { id: "u_other", name: "Zoya", email: "zoya@example.com" };
const future = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test("a jam needs a title, city and a real date", async () => {
  const env = makeEnv();
  assert.equal((await createJam(env, { city: "Pune" }, { me: host })).error[0], 400);
  assert.equal((await createJam(env, { title: "x", city: "Pune", date: "not-a-date" }, { me: host })).error[0], 400);
  assert.equal(
    (await createJam(env, { title: "x", city: "Pune", date: "2020-01-01" }, { me: host })).error[0],
    400,
    "past dates are rejected"
  );
  assert.equal((await createJam(env, { title: "x", city: "Pune", date: future() }, { me: null })).error[0], 401);
  const r = await createJam(env, { title: "Sufi acoustic circle", city: "Pune", date: future() }, { me: host });
  assert.ok(r.jam, JSON.stringify(r));
  assert.ok(JAM_KINDS.includes(r.jam.kind));
  assert.equal(r.jam.status, "open");
});

test("hosts hit a ceiling so the feed cannot be spammed", async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    const r = await createJam(env, { title: `jam ${i}`, city: "Pune", date: future() }, { me: host });
    assert.ok(r.jam, `jam ${i} should create: ${JSON.stringify(r)}`);
  }
  const sixth = await createJam(env, { title: "one too many", city: "Pune", date: future() }, { me: host });
  assert.equal(sixth.error[0], 429);
});

test("list filters by city and kind and marks what you joined", async () => {
  const env = makeEnv();
  await ensureJamSchema(env);
  const a = (await createJam(env, { title: "Pune jam", city: "Pune", date: future(), kind: "jam" }, { me: host })).jam;
  await createJam(env, { title: "Jaipur hangout", city: "Jaipur", date: future(), kind: "hangout" }, { me: host });

  const all = await listJams(env.DB, {});
  assert.equal(all.length, 2);
  const pune = await listJams(env.DB, { city: "Pune" });
  assert.equal(pune.length, 1);
  const hangs = await listJams(env.DB, { kind: "hangout" });
  assert.equal(hangs[0].title, "Jaipur hangout");

  await rsvpJam(env, a.token, joiner);
  const mine = await listJams(env.DB, { meId: joiner.id });
  const row = mine.find((j) => j.id === a.id);
  assert.equal(row.joined, true);
  assert.equal(row.going, 1);
});

test("RSVP toggles, fills capacity and flips status to full", async () => {
  const env = makeEnv();
  const jam = (await createJam(env, { title: "Tiny jam", city: "Pune", date: future(), capacity: 2 }, { me: host })).jam;

  assert.deepEqual(await rsvpJam(env, jam.token, joiner), { joined: true, going: 1 });
  const again = await rsvpJam(env, jam.token, joiner);
  assert.equal(again.joined, false, "second tap leaves");
  assert.equal(again.going, 0);

  await rsvpJam(env, jam.token, joiner);
  const full = await rsvpJam(env, jam.token, stranger);
  assert.equal(full.joined, true);
  const detail = await jamDetail(env.DB, jam.token);
  assert.equal(detail.jam.status, "full");
  const over = await rsvpJam(env, jam.token, { id: "u_third", name: "Third" });
  assert.equal(over.error[0], 409, "a full jam rejects the third guest");

  // Leaving a full jam reopens it.
  const left = await rsvpJam(env, jam.token, stranger);
  assert.equal(left.joined, false);
  const reopened = await env.DB.prepare("SELECT status FROM jam_sessions WHERE id = ?").bind(jam.id).first();
  assert.equal(reopened.status, "open");
});

test("only the host can broadcast, only on the day, rate-limited", async () => {
  const env = makeEnv();
  const todayStr = new Date().toISOString().slice(0, 10);
  const jam = (await createJam(env, { title: "Tonight jam", city: "Pune", date: todayStr }, { me: host })).jam;

  assert.equal((await broadcastJam(env, jam.token, stranger)).error[0], 403);

  const first = await broadcastJam(env, jam.token, host);
  assert.equal(first.ok, true);
  assert.equal(first.jam.broadcasts, 1);

  const again = await broadcastJam(env, jam.token, host);
  assert.equal(again.error[0], 429, "second broadcast inside 30 minutes is throttled");

  // Tomorrow's jam cannot go live early.
  const tomorrow = (await createJam(env, { title: "Tomorrow", city: "Pune", date: future() }, { me: host })).jam;
  assert.equal((await broadcastJam(env, tomorrow.token, host)).error[0], 409);
});

test("a live broadcast flips the feed row to live", async () => {
  const env = makeEnv();
  const todayStr = new Date().toISOString().slice(0, 10);
  const jam = (await createJam(env, { title: "Live one", city: "Pune", date: todayStr }, { me: host })).jam;
  await broadcastJam(env, jam.token, host);
  const [row] = await listJams(env.DB, {});
  assert.equal(row.live, true);
  const detail = await jamDetail(env.DB, jam.token);
  assert.equal(detail.jam.live, true);
});

test("cancel closes the jam for everyone", async () => {
  const env = makeEnv();
  const jam = (await createJam(env, { title: "Doomed", city: "Pune", date: future() }, { me: host })).jam;
  assert.equal((await cancelJam(env, jam.token, stranger)).error[0], 403);
  assert.equal((await cancelJam(env, jam.token, host)).ok, true);
  const after = await env.DB.prepare("SELECT status FROM jam_sessions WHERE id = ?").bind(jam.id).first();
  assert.equal(after.status, "cancelled");
  assert.equal((await rsvpJam(env, jam.token, joiner)).error[0], 409);
  assert.equal((await listJams(env.DB, {})).length, 0, "cancelled jams leave the feed");
});

test("the sweep retires finished jams and purges old corpses", async () => {
  const env = makeEnv();
  await ensureJamSchema(env);
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);

  await env.DB.prepare(`INSERT INTO jam_sessions (id, token, host_id, title, city, date, start_time, status)
    VALUES ('j1','t1','u_host','Yesterday jam','Pune',?,'19:00','open')`).bind(yday).run();
  await env.DB.prepare(`INSERT INTO jam_sessions (id, token, host_id, title, city, date, start_time, status)
    VALUES ('j2','t2','u_host','Ancient jam','Pune',?,'19:00','open')`).bind(old).run();
  await env.DB.prepare("INSERT INTO jam_rsvps (jam_id, user_id, name) VALUES ('j2','u_x','X')").run();

  const run = await runJamSweep(env, { trigger: "manual" });
  assert.equal(run.ok, true);
  assert.ok(run.expired >= 2, JSON.stringify(run));
  assert.equal(run.purged, 1, "40-day-old dead jam is deleted with its RSVPs");

  const gone = await env.DB.prepare("SELECT COUNT(*) n FROM jam_sessions WHERE id = 'j2'").first();
  assert.equal(gone.n, 0);
  const rsvps = await env.DB.prepare("SELECT COUNT(*) n FROM jam_rsvps WHERE jam_id = 'j2'").first();
  assert.equal(rsvps.n, 0);
  const runs = await env.DB.prepare("SELECT COUNT(*) n FROM jam_runs WHERE trigger = 'manual'").first();
  assert.equal(runs.n, 1, "the sweep records its run");
});

test("same-day jams expire four hours after the posted start", async () => {
  const env = makeEnv();
  await ensureJamSchema(env);
  const todayStr = new Date().toISOString().slice(0, 10);
  // Started at 06:00 — long over by now regardless of the wall clock.
  await env.DB.prepare(`INSERT INTO jam_sessions (id, token, host_id, title, city, date, start_time, status)
    VALUES ('j3','t3','u_host','Morning jam','Pune',?,'06:00','open')`).bind(todayStr).run();
  const run = await runJamSweep(env, { trigger: "manual" });
  const row = await env.DB.prepare("SELECT status FROM jam_sessions WHERE id = 'j3'").first();
  if (new Date().toISOString().slice(11, 16) >= "10:00") {
    assert.equal(row.status, "expired", JSON.stringify(run));
  } else {
    assert.ok(["open", "expired"].includes(row.status));
  }
});

test("jam alerts fire once for new sessions in your city", async () => {
  const env = makeEnv();
  await ensureJamSchema(env);
  await ensureRequestSchema(env);
  await env.DB.prepare("INSERT INTO alerts (id, kind, city, email) VALUES ('aj','jams','Pune','me@example.com')").run();

  await createJam(env, { title: "Alert-worthy jam", city: "Pune", date: future() }, { me: host });
  const first = await runAlerts(env, { now: Date.now() });
  assert.equal(first.fired, 1, JSON.stringify(first));

  const second = await runAlerts(env, { now: Date.now() + 1000 });
  assert.equal(second.fired, 0, "already-delivered alerts stay quiet");

  // A different city's jam does not re-fire this alert.
  await createJam(env, { title: "Far away", city: "Jaipur", date: future() }, { me: host });
  const third = await runAlerts(env, { now: Date.now() + 2000 });
  assert.equal(third.fired, 0);
});
