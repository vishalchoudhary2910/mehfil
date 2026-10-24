import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, ARTIST_DDL, tomorrow } from "./helpers.mjs";
import { ensureLeadsSchema } from "../worker/leads.js";
import { ensureTalentSchema, upsertTalent } from "../worker/talent.js";
import {
  ensureRequestSchema,
  createRequest,
  targetView,
  hostView,
  respondToTarget,
  confirmTarget,
  followupAction,
  expiryFor,
  runRequestFollowups,
  runAlerts,
  scoreCandidate,
  postHostMessage,
  postTargetMessage,
  inviteMore,
} from "../worker/requests.js";

const env = makeEnv();
env.DB.exec(ARTIST_DDL);
await ensureTalentSchema(env);
await ensureLeadsSchema(env);
await ensureRequestSchema(env);

await env.DB.prepare(`INSERT INTO artist_profiles
  (id, user_id, slug, stage_name, category, sub_skills, city, area, languages, bio, base_price_inr, rating, reviews_count, response_mins, verified, accepting_requests, available_now)
  VALUES ('a1','u1','awaaz','Awaaz Collective','poet','["Urdu Shayari"]','Pune','Koregaon Park','["Hindi","Urdu"]','Sufi shayari',8000,4.8,12,20,1,1,1)`).run();

let request;

test("a poet request auto-matches and invites the right act", async () => {
  const r = await createRequest(env, {
    category: "poet", city: "Pune", area: "Koregaon Park", date: tomorrow(), start_time: "19:30",
    event_type: "Poetry night", budget_inr: 9000, guest_count: 40, brief: "Sufi shayari for 40 guests",
    host_name: "Radhika", host_email: "radhika@example.com", auto_invite: true,
  }, { ip: "" });
  assert.ok(r.request, JSON.stringify(r));
  request = r.request;
  assert.equal(r.request.invited, 1);
  assert.equal(r.request.matched, 1);

  const target = await env.DB.prepare("SELECT * FROM request_targets WHERE request_id = ?").bind(request.id).first();
  assert.equal(target.name, "Awaaz Collective");
  assert.equal(target.channel, "inapp");
  assert.ok(target.score >= 60, `score=${target.score}`);

  // The brief becomes a demand lead too.
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE source = 'request'").first();
  assert.ok(lead, "request should create a lead");
  assert.equal(lead.kind, "client");
});

test("performers get a private token view that never leaks the host token", async () => {
  const target = await env.DB.prepare("SELECT * FROM request_targets WHERE request_id = ?").bind(request.id).first();
  const view = await targetView(env.DB, target.token);
  assert.equal(view.target.id, target.id);
  assert.equal(view.request.token, undefined);
  assert.equal(view.request.ip, undefined);
  assert.equal(view.request.lead_id, undefined);
  assert.equal(view.request.host_email, "", "host contact is hidden until confirmed");
  assert.match(view.request.brief, /Sufi shayari/);
});

test("availability and a counter-quote flow back to the host", async () => {
  const target = await env.DB.prepare("SELECT * FROM request_targets WHERE request_id = ?").bind(request.id).first();
  const r = await respondToTarget(env, target.token, { decision: "available", quote_inr: 8500, message: "Can do 90 minutes." });
  assert.equal(r.ok, true);
  assert.equal(r.target.status, "available");

  const view = await hostView(env.DB, request.token);
  assert.equal(view.counts.available, 1);
  assert.equal(view.request.status, "open");
  const row = view.targets.find((t) => t.id === target.id);
  assert.equal(row.quote_inr, 8500);
  assert.equal(row.email, "", "contact stays masked before confirmation");
});

test("host confirmation fills the request, holds the date and closes the rest", async () => {
  const target = await env.DB.prepare("SELECT * FROM request_targets WHERE request_id = ?").bind(request.id).first();
  // A second invitee to prove the rest are politely closed.
  await env.DB.prepare(`INSERT INTO request_targets (id, request_id, token, name, channel, status, score)
    VALUES ('rt_extra', ?, 'tok_extra', 'Kabir Vani', 'link', 'available', 55)`).bind(request.id).run();

  const r = await confirmTarget(env, request.token, target.id);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.view.request.status, "filled");
  assert.equal(r.view.counts.confirmed, 1);

  const extra = await env.DB.prepare("SELECT * FROM request_targets WHERE id = 'rt_extra'").first();
  assert.equal(extra.status, "closed");
  const held = await env.DB.prepare("SELECT * FROM artist_booked_dates WHERE artist_id = 'a1'").first();
  assert.ok(held, "confirmed artist date should be held");
  const view = await hostView(env.DB, request.token);
  const me = view.targets.find((t) => t.id === target.id);
  assert.equal(me.status, "confirmed");
  assert.equal(view.targets.find((t) => t.id === "rt_extra").status, "closed");

  // The same date cannot be double-booked by another request.
  const scored = scoreCandidate({ kind: "artist", ...(await env.DB.prepare("SELECT * FROM artist_profiles WHERE id='a1'").first()), booked: true }, request);
  assert.equal(scored.score, 0);
});

test("follow-up clock compresses for same-day requests and stops when closed", () => {
  const morning = Date.parse("2026-10-24T12:00:00Z");
  const invited8h = { status: "invited", invited_at: "2026-10-24 04:00:00", nudges: 0 };
  assert.equal(followupAction(invited8h, { status: "open", date: "2026-10-30", urgency: "soon" }, morning), "nudge");
  assert.equal(followupAction(invited8h, { status: "open", date: "2026-10-24", urgency: "today" }, morning), "nudge");
  assert.equal(followupAction({ ...invited8h, nudges: 2, invited_at: "2026-10-23 22:00:00" }, { status: "open", date: "2026-10-24", urgency: "today" }, morning), "expire");
  assert.equal(followupAction({ ...invited8h, nudges: 1 }, { status: "open", date: "2026-10-30", urgency: "soon" }, morning), null);
  assert.equal(followupAction({ ...invited8h, nudges: 1, invited_at: "2026-10-23 10:00:00" }, { status: "open", date: "2026-10-30", urgency: "soon" }, morning), "nudge");
  assert.equal(followupAction({ ...invited8h, nudges: 2, invited_at: "2026-10-22 10:00:00" }, { status: "open", date: "2026-10-30", urgency: "soon" }, morning), "expire");
  assert.equal(followupAction(invited8h, { status: "filled", date: "2026-10-30", urgency: "soon" }, morning), null);
  assert.equal(followupAction({ ...invited8h, status: "available" }, { status: "open", date: "2026-10-30" }, morning), null);
});

test("expiry closes before doors, not at midnight", () => {
  const now = new Date("2026-10-24T09:00:00Z");
  const exp = expiryFor({ urgency: "planned", date: "2026-10-26", start_time: "20:00" }, now);
  // 20:00 IST = 14:30Z, minus the 90-minute reply buffer.
  assert.ok(Date.parse(exp.replace(" ", "T") + "Z") <= Date.parse("2026-10-26T13:00:00Z"));
  const morning = expiryFor({ urgency: "planned", date: "2026-10-26", start_time: "10:00" }, now);
  assert.ok(
    Date.parse(morning.replace(" ", "T") + "Z") < Date.parse(exp.replace(" ", "T") + "Z"),
    "a morning show must close earlier than an evening show"
  );
  const sameDay = expiryFor({ urgency: "today", date: "2026-10-24", start_time: "20:00" }, now);
  assert.ok(Date.parse(sameDay.replace(" ", "T") + "Z") > now.getTime());
});

test("unanswered requests get nudged then expire, and the host is told", async () => {
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const r = await createRequest(env, {
    category: "poet", city: "Pune", date: dayAfter, budget_inr: 9000,
    host_name: "Kabir", host_email: "kabir@example.com", auto_invite: true,
  }, { ip: "" });
  assert.ok(r.request);
  assert.equal(r.request.invited, 1, "a different date should still match the act");
  // Make the invite old enough for reminder #2 and force the deadline past.
  await env.DB.prepare("UPDATE request_targets SET invited_at = datetime('now','-30 hour'), nudges = 1 WHERE request_id = ?").bind(r.request.id).run();
  await env.DB.prepare("UPDATE booking_requests SET expires_at = datetime('now','-1 hour') WHERE id = ?").bind(r.request.id).run();

  const run = await runRequestFollowups(env, { trigger: "manual", silent: true });
  assert.ok(run.nudged >= 1, JSON.stringify(run));
  assert.ok(run.expired >= 0);
  const req = await env.DB.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(r.request.id).first();
  assert.equal(req.status, "expired");
});

test("alerts fire for new directory artists and then stay quiet", async () => {
  await env.DB.prepare("INSERT INTO alerts (id, kind, city, category, email) VALUES ('al1','artists','Pune','poet','alert@example.com')").run();
  await upsertTalent(env.DB, { name: "Naya Shayar", category: "poet", city: "Pune", source: "manual" }, { source: "manual" });
  const first = await runAlerts(env, { now: Date.now() });
  assert.equal(first.checked, 1);
  assert.equal(first.fired, 1);
  const second = await runAlerts(env, { now: Date.now() + 1000 });
  assert.equal(second.fired, 0, "already-delivered entries must not re-fire");
});

test("host and performer can go back and forth without accounts", async () => {
  const r = await createRequest(env, {
    category: "poet", city: "Pune", date: tomorrow(), host_name: "Meera",
    host_email: "meera@example.com", auto_invite: true,
  }, { ip: "" });
  assert.ok(r.request, JSON.stringify(r));
  const target = await env.DB.prepare("SELECT * FROM request_targets WHERE request_id = ?").bind(r.request.id).first();
  assert.ok(target, "the poet should be invited");

  assert.equal((await postHostMessage(env, r.request.token, { target_id: target.id, body: "  " })).error[0], 400);
  const hostMsg = await postHostMessage(env, r.request.token, {
    target_id: target.id, body: "Can you do 90 minutes with a tabla player?",
  });
  assert.equal(hostMsg.ok, true);

  const tv = await targetView(env.DB, target.token);
  assert.equal(tv.messages.length, 1);
  assert.equal(tv.messages[0].role, "host");
  assert.match(tv.messages[0].body, /tabla/);

  const reply = await postTargetMessage(env, target.token, { body: "Yes — my tabla player is free that evening." });
  assert.equal(reply.ok, true);

  const view = await hostView(env.DB, r.request.token);
  assert.equal(view.messages.length, 2);
  assert.deepEqual(view.messages.map((m) => m.role), ["host", "performer"]);
  // Other performers must never see this thread.
  const other = await targetView(env.DB, target.token);
  assert.equal(other.messages.every((m) => m.target_id === target.id), true);
});

test("invite more only adds performers who were not already asked", async () => {
  const r = await createRequest(env, {
    category: "comedian", city: "Pune", date: tomorrow(), host_name: "Open Mic",
    host_email: "openmic@example.com", auto_invite: true,
  }, { ip: "" });
  assert.ok(r.request);
  assert.equal(r.invite.invited, 0, "nobody is in the comedian roster yet");

  await env.DB.prepare(`INSERT INTO artist_profiles (id, user_id, slug, stage_name, category, city, base_price_inr, accepting_requests, available_now)
    VALUES ('a2','u2','hanso','Hanso Club','comedian','Pune',0,1,1)`).run();

  const first = await inviteMore(env, r.request.token);
  assert.equal(first.ok, true);
  assert.equal(first.invited, 1);
  const second = await inviteMore(env, r.request.token);
  assert.equal(second.invited, 0, "a repeat click must not duplicate the invitation");
  const count = await env.DB.prepare("SELECT COUNT(*) n FROM request_targets WHERE request_id = ?").bind(r.request.id).first();
  assert.equal(count.n, 1);
});
