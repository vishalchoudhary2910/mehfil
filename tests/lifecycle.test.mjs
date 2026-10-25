import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { makeEnv, ARTIST_DDL } from "./helpers.mjs";
import { ensureLeadsSchema, upsertLead, contactLead } from "../worker/leads.js";
import { ensureGrowthSchema } from "../worker/growth.js";
import {
  ensureLifecycleSchema, recordConsent, runLifecycle, mountLifecycleRoutes,
} from "../worker/lifecycle.js";

const FIXED = Date.UTC(2026, 9, 25, 10, 0, 0); // 15:30 IST — inside send window
const QUIET = Date.UTC(2026, 9, 25, 20, 0, 0); // 01:30 IST — outside

const BOOKINGS_DDL = `CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, host_id TEXT, artist_id TEXT,
  event_date TEXT, status TEXT
);`;

async function setup() {
  const sent = [];
  const env = makeEnv({
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "Mehfil <hello@mehfil.test>",
    fetch: async (url, init = {}) => {
      sent.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "em_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await ensureLeadsSchema(env);
  await ensureGrowthSchema(env);
  await ensureLifecycleSchema(env);
  env.DB.exec(ARTIST_DDL);
  env.DB.exec(BOOKINGS_DDL);
  return { env, sent };
}

async function addArtist(env, { id = "a1", slug = "neon-strings", name = "Neon Strings", category = "band", city = "Pune" } = {}) {
  await env.DB
    .prepare(
      `INSERT INTO artist_profiles (id, slug, stage_name, category, city, base_price_inr, rating, verified, gigs_done)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, slug, name, category, city, 9000, 4.8, 1, 12)
    .run();
}

async function addVenue(env, { id = "vi_1", email = "riya@venue.test" } = {}) {
  await env.DB
    .prepare(
      `INSERT INTO venue_interest (id, name, venue, city, kind, need, date, email, phone)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, "Riya", "Cafe Kapi", "Pune", "cafe", "acoustic duo", "2026-11-20", email, "")
    .run();
}

test("cold lead without consent is queued, never emailed", async () => {
  const { env, sent } = await setup();
  const lead = await upsertLead(
    env.DB,
    { name: "Cafe One", kind: "venue", city: "Pune", email: "owner@cafe.test", source: "places" },
    { createdBy: "test" }
  );
  const queued = await contactLead(env.DB, env, lead.lead, "test", { now: FIXED });
  assert.equal(queued.queued, true);
  assert.equal(sent.length, 0, "no cold email may leave the worker");
  const q = await env.DB.prepare("SELECT COUNT(*) n FROM outreach_queue").first();
  assert.equal(Number(q.n), 1);
  const stale = await env.DB.prepare("SELECT status FROM leads WHERE id = ?").bind(lead.lead.id).first();
  assert.equal(stale.status, "new", "queued is not contacted");

  await recordConsent(env.DB, { email: "owner@cafe.test", purpose: "outreach", source: "test" });
  const ok = await contactLead(env.DB, env, lead.lead, "test", { now: FIXED });
  assert.equal(ok.sent, true);
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0].init.body);
  assert.deepEqual(payload.to, ["owner@cafe.test"]);
  assert.match(payload.headers["List-Unsubscribe"], /\/unsubscribe\?token=ut_/);
  assert.match(payload.text, /Unsubscribe:/);
  const contacted = await env.DB.prepare("SELECT status FROM leads WHERE id = ?").bind(lead.lead.id).first();
  assert.equal(contacted.status, "contacted");
});

test("unsubscribe suppresses the address and stops active sequences", async () => {
  const { env } = await setup();
  const consent = await recordConsent(env.DB, {
    email: "riya@venue.test", purpose: "venue_shortlist", source: "venue_form",
  });
  await env.DB
    .prepare(
      `INSERT INTO lifecycle_sequences (id, kind, subject_id, email, name, city, meta, stage, status, next_at)
       VALUES ('sq_1','venue','vi_1','riya@venue.test','Riya','Pune','{}',0,'active',?)`
    )
    .bind(new Date(FIXED).toISOString())
    .run();

  const app = new Hono();
  mountLifecycleRoutes(app);
  const res = await app.request(
    `http://127.0.0.1:8787/unsubscribe?token=${encodeURIComponent(consent.token)}`,
    {},
    env
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), /unsubscribed/i);

  const row = await env.DB.prepare("SELECT withdrawn_at FROM outreach_consents WHERE id = ?").bind(consent.id).first();
  assert.ok(row.withdrawn_at);
  const sup = await env.DB
    .prepare("SELECT 1 AS n FROM suppressions WHERE channel = 'email' AND address = ?")
    .bind("riya@venue.test")
    .first();
  assert.ok(sup);
  const seq = await env.DB.prepare("SELECT status FROM lifecycle_sequences WHERE id = 'sq_1'").first();
  assert.equal(seq.status, "stopped");
});

test("venue enquiry gets a shortlist sequence, then follow-ups, then stops", async () => {
  const { env, sent } = await setup();
  await addArtist(env, { id: "a1", slug: "neon-strings", name: "Neon Strings", category: "band" });
  await addArtist(env, { id: "a2", slug: "sunset-duo", name: "Sunset Duo", category: "singer" });
  await addVenue(env);

  const first = await runLifecycle(env, { now: FIXED });
  assert.equal(first.venue_started, 1);
  assert.equal(first.sent, 1);
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0].init.body);
  assert.equal(payload.to[0], "riya@venue.test");
  assert.match(payload.subject, /shortlist/i);
  assert.match(payload.text, /Neon Strings/);
  assert.match(payload.text, /Sunset Duo/);
  assert.match(payload.text, /\/artist\//);

  const seq = await env.DB.prepare("SELECT stage, status, next_at FROM lifecycle_sequences WHERE subject_id = 'vi_1'").first();
  assert.equal(Number(seq.stage), 1);
  assert.equal(seq.status, "active");

  const sameDay = await runLifecycle(env, { now: FIXED + 60 * 60 * 1000 });
  assert.equal(sameDay.sent, 0, "stage 1 is not due yet");

  const day3 = await runLifecycle(env, { now: FIXED + 3 * 86400000 });
  assert.equal(day3.sent, 1);
  assert.match(JSON.parse(sent[1].init.body).subject, /questions/i);

  const day9 = await runLifecycle(env, { now: FIXED + 9 * 86400000 });
  assert.equal(day9.sent, 1);
  const last = await env.DB.prepare("SELECT stage, status FROM lifecycle_sequences WHERE subject_id = 'vi_1'").first();
  assert.equal(Number(last.stage), 3);
  assert.equal(last.status, "done");
});

test("quiet hours defer sends without losing the sequence", async () => {
  const { env, sent } = await setup();
  await addArtist(env);
  await addVenue(env);

  const out = await runLifecycle(env, { now: QUIET });
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0, "no email outside 09:00-19:00 IST");
  const seq = await env.DB.prepare("SELECT stage, status FROM lifecycle_sequences WHERE subject_id = 'vi_1'").first();
  assert.equal(Number(seq.stage), 0);
  assert.equal(seq.status, "active");
});

test("past bookings trigger a rebook prompt and one reminder", async () => {
  const { env, sent } = await setup();
  await env.DB
    .prepare("INSERT INTO users (id, auth_sub, name, email, kind) VALUES ('u_host','auth|host','Riya','riya@host.test','host')")
    .run();
  await addArtist(env, { id: "a1", slug: "neon-strings", name: "Neon Strings" });
  await env.DB
    .prepare("INSERT INTO bookings (id, host_id, artist_id, event_date, status) VALUES ('b1','u_host','a1','2026-10-01','completed')")
    .run();

  const first = await runLifecycle(env, { now: FIXED });
  assert.equal(first.rebook_started, 1);
  assert.equal(first.sent, 1);
  const payload = JSON.parse(sent[0].init.body);
  assert.match(payload.subject, /Book Neon Strings again/);
  assert.match(payload.text, /\/artist\/neon-strings/);
  const seq = await env.DB.prepare("SELECT stage, status FROM lifecycle_sequences WHERE kind = 'rebook'").first();
  assert.equal(Number(seq.stage), 1);

  const next = await runLifecycle(env, { now: FIXED + 8 * 86400000 });
  assert.equal(next.sent, 1);
  assert.match(JSON.parse(sent[1].init.body).subject, /still planning/i);
  const done = await env.DB.prepare("SELECT stage, status FROM lifecycle_sequences WHERE kind = 'rebook'").first();
  assert.equal(Number(done.stage), 2);
  assert.equal(done.status, "done");
});
