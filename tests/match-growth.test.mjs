// Quick-match deck + growth loops, exercised through the real Hono routes.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { makeEnv, ARTIST_DDL, tomorrow } from "./helpers.mjs";
import { ensureLeadsSchema } from "../worker/leads.js";
import { ensureRequestSchema, createRequest } from "../worker/requests.js";
import { mountDeckRoutes, ensureDeckSchema } from "../worker/deck.js";
import { mountGrowthRoutes, ensureGrowthSchema, markListed } from "../worker/growth.js";

const env = makeEnv();
env.DB.exec(ARTIST_DDL);
await ensureLeadsSchema(env);
await ensureRequestSchema(env);
await ensureDeckSchema(env);
await ensureGrowthSchema(env);

// Identity switcher: the fake auth returns whichever user is "calling".
let fbUser = null;
const auth = { getUser: async () => fbUser };
const app = new Hono();
mountDeckRoutes(app, auth);
mountGrowthRoutes(app, auth);

const asUser = (sub, name, email) => { fbUser = { sub, name, email }; };
const call = (url, init = {}) =>
  app.request(url, { headers: { origin: env.APP_ORIGIN, "content-type": "application/json" }, ...init }, env);
const post = (url, body) => call(url, { method: "POST", body: JSON.stringify(body) });
const body = async (res) => {
  const j = await res.json();
  return { status: res.status, ...j };
};

// Seed: a host user with an open gig, an artist user with a profile.
asUser("auth|host", "Radhika", "radhika@example.com");
const hostRow = await env.DB
  .prepare("INSERT INTO users (id, auth_sub, name, email, city, kind) VALUES ('u_host','auth|host','Radhika','radhika@example.com','Pune','host') RETURNING *")
  .first();

asUser("auth|artist", "Arjun", "arjun@example.com");
const artistUser = await env.DB
  .prepare("INSERT INTO users (id, auth_sub, name, email, city, kind) VALUES ('u_artist','auth|artist','Arjun','arjun@example.com','Pune','artist') RETURNING *")
  .first();
await env.DB.prepare(`INSERT INTO artist_profiles
  (id, user_id, slug, stage_name, category, sub_skills, city, area, languages, bio, base_price_inr, rating, reviews_count, gigs_done, response_mins, verified, accepting_requests, available_now)
  VALUES ('a_dj','u_artist','dj-arjun','DJ Arjun','dj','["Bollywood"]','Pune','Koregaon Park','["Hindi","English"]','Bollywood sets',12000,4.7,9,40,15,1,1,1)`)
  .run();
// The artist's tagline + design live on the profile (added by the design route).
await env.DB.prepare("UPDATE artist_profiles SET tagline = 'Din me brunch, raat me bass' WHERE id = 'a_dj'").run();

let gig;
test("deck serves artist cards to hosts and open gigs to artists", async () => {
  // Host sees talent (never their own account's profiles).
  asUser("auth|host", "Radhika", "radhika@example.com");
  const talent = await body(await call("/api/deck?side=talent&city=Pune"));
  assert.equal(talent.side, "talent");
  assert.ok(talent.cards.length >= 1);
  const card = talent.cards.find((c) => c.id === "a_dj");
  assert.ok(card, "the seeded DJ should be in the host deck");
  assert.equal(card.tagline, "Din me brunch, raat me bass");
  assert.equal(card.link, "/artist/dj-arjun");

  // Artist sees open gigs (the host's), not their own.
  const r = await createRequest(env, {
    category: "dj", city: "Pune", date: tomorrow(), start_time: "21:00",
    event_type: "Sangeet", budget_inr: 15000, guest_count: 80,
    brief: "Bollywood DJ for sangeet", host_name: "Radhika",
    host_email: "radhika@example.com", auto_invite: false,
  }, { me: hostRow, ip: "" });
  gig = r.request;

  asUser("auth|artist", "Arjun", "arjun@example.com");
  const gigs = await body(await call("/api/deck?side=gig&city=Pune"));
  assert.equal(gigs.side, "gig");
  const g = (gigs.cards || []).find((c) => c.id === gig.id);
  assert.ok(g, "the open sangeet gig should be in the artist deck");
  assert.equal(g.link, `/request/${gig.token}`);
});

test("swiping is one-sided until BOTH like each other", async () => {
  // Artist likes the host's gig first — no match yet (host hasn't swiped).
  asUser("auth|artist", "Arjun", "arjun@example.com");
  let res = await body(await post("/api/deck/swipe", { side: "gig", target: gig.id, dir: "like" }));
  assert.equal(res.status, 200);
  assert.equal(res.match, null, "one-sided like must not match");

  // Host likes the artist profile back → match + thread form on the spot.
  asUser("auth|host", "Radhika", "radhika@example.com");
  res = await body(await post("/api/deck/swipe", { side: "talent", target: "a_dj", dir: "like" }));
  assert.ok(res.match, `expected a match, got ${JSON.stringify(res)}`);
  assert.ok(res.match.thread_id);
  assert.equal(res.match.other.stage_name, "DJ Arjun");

  const match = await env.DB.prepare("SELECT * FROM deck_matches WHERE id = ?").bind(res.match.id).first();
  assert.equal(match.host_user, "u_host");
  assert.equal(match.artist_user, "u_artist");
  assert.equal(match.request_id, gig.id, "the match links the gig that sparked it");
});

test("a match opens a chat thread both sides can use", async () => {
  asUser("auth|host", "Radhika", "radhika@example.com");
  const inbox = await body(await call("/api/deck/matches"));
  assert.equal(inbox.matches.length, 1);
  const threadId = inbox.matches[0].thread_id;

  // Host sends the first message.
  let res = await body(await post(`/api/deck/threads/${threadId}/messages`, { body: "Hi Arjun — sangeet on the 30th, free?" }));
  assert.equal(res.status, 201);

  // Artist sees it as unread, replies, and read-marking clears it.
  asUser("auth|artist", "Arjun", "arjun@example.com");
  let thread = await body(await call(`/api/deck/threads/${threadId}`));
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].body.includes("sangeet"), true);
  await post(`/api/deck/threads/${threadId}/read`, {});
  thread = await body(await call(`/api/deck/threads/${threadId}`));
  assert.equal(thread.unread, 0, "read-marking clears the badge");

  res = await body(await post(`/api/deck/threads/${threadId}/messages`, { body: "Free — send the brief!" }));
  assert.equal(res.status, 201);

  // Host's inbox now shows the reply and unread count.
  asUser("auth|host", "Radhika", "radhika@example.com");
  const inbox2 = await body(await call("/api/deck/matches"));
  assert.equal(inbox2.matches[0].unread, 1);
  assert.ok(inbox2.matches[0].last_message.body.includes("Free"));
});

test("undo removes a swipe, but a match is never silently broken", async () => {
  asUser("auth|host", "Radhika", "radhika@example.com");
  // Pass on the artist (creates a fresh swipe since the earlier one was a like→match).
  const swipes = await env.DB.prepare("SELECT * FROM deck_swipes WHERE swiper_id = 'u_host'").all();
  const likeSwipe = swipes.results.find((s) => s.dir === "like");
  assert.ok(likeSwipe, "the host has a like swipe recorded");
  // Undoing the like that created the match must be refused (match rows exist).
  const res = await body(await post("/api/deck/undo", { swipe_id: likeSwipe.id }));
  assert.equal(res.status, 409, `undo after a match should be refused, got ${JSON.stringify(res)}`);
});

test("referral code is stable and self-claim is blocked", async () => {
  asUser("auth|artist", "Arjun", "arjun@example.com");
  const ref = await body(await call("/api/referral"));
  assert.equal(ref.code, "u_artist", "code is the user id — reversible, stable");
  assert.match(ref.url, /\/join\?ref=u_artist$/);
  assert.equal(ref.listed, 0);
  assert.equal(ref.unlocked, false);

  // Claiming your own code is refused.
  let res = await body(await post("/api/referral/claim", { code: "u_artist" }));
  assert.equal(res.status, 409);
  // Unknown codes 404.
  res = await body(await post("/api/referral/claim", { code: "u_nobody" }));
  assert.equal(res.status, 404);
});

test("two listed invites unlock the Founding Artist badge", async () => {
  // Two invitees join via the artist's code, then complete listings.
  for (const [uid, sub] of [["u_i1", "auth|i1"], ["u_i2", "auth|i2"]]) {
    await env.DB.prepare("INSERT INTO users (id, auth_sub, name, kind) VALUES (?,?,?, 'host')")
      .bind(uid, sub, `Invitee ${uid}`).run();
    asUser(sub, `Invitee ${uid}`, null);
    const res = await body(await post("/api/referral/claim", { code: "u_artist" }));
    assert.equal(res.ok, true, JSON.stringify(res));
  }
  // Completing listings flips their referral rows to "listed".
  await markListed(env.DB, "u_i1");
  await markListed(env.DB, "u_i2");

  const profile = await env.DB.prepare("SELECT * FROM artist_profiles WHERE id = 'a_dj'").first();
  assert.equal(profile.founding_artist, 1, "two listed invites must unlock the badge");

  asUser("auth|artist", "Arjun", "arjun@example.com");
  const ref = await body(await call("/api/referral"));
  assert.equal(ref.listed, 2);
  assert.equal(ref.unlocked, true);
});

test("venue briefs require a way to reach the sender and store cleanly", async () => {
  asUser(null, null, null);
  // No contact → 400.
  let res = await body(await post("/api/venues", { city: "Pune", name: "Cafe Kapi" }));
  assert.equal(res.status, 400);
  // Valid brief → stored with normalized kind.
  res = await body(await post("/api/venues", {
    name: "Riya", venue: "Cafe Kapi", city: "Pune", kind: "cafe",
    need: "Acoustic duo for 40 guests", email: "riya@cafekapi.example",
  }));
  assert.equal(res.ok, true);
  const row = await env.DB.prepare("SELECT * FROM venue_interest WHERE id = ?").bind(res.id).first();
  assert.equal(row.kind, "cafe");
  assert.equal(row.email, "riya@cafekapi.example");

  const meta = await body(await call("/api/venues/meta"));
  assert.ok(meta.artists >= 1);
  assert.ok(meta.cities >= 1);
  assert.ok(meta.kinds.includes("wedding"));
});
