import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, mockFetch } from "./helpers.mjs";
import {
  ensureShowSchema,
  parseIcal,
  icalDate,
  mapIcalEvent,
  inferPrice,
  parseRss,
  mapRssItem,
  extractEventDate,
  runShowFeed,
  upsertShow,
} from "../worker/showfeed.js";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1@example
SUMMARY:Sufi Shayari Night — Awaaz Collective
DTSTART;TZID=Asia/Kolkata:20261115T193000
LOCATION:The Workshop Cafe\\, Koregaon Park\\, Pune
DESCRIPTION:Lineup: Awaaz Collective\\, Kabir Vani
 Free entry\\, doors 7 pm
URL:https://example.com/evt-1
END:VEVENT
BEGIN:VEVENT
UID:evt-2@example
SUMMARY:Comedy Open Mic
DTSTART:20261120T143000Z
LOCATION:STUDIO X\\, Bandra\\, Mumbai
DESCRIPTION:Tickets from ₹499. Stand-up night with Rahul
END:VEVENT
END:VCALENDAR`;

test("iCal parser unfolds lines and keeps event fields", () => {
  const events = parseIcal(ICS);
  assert.equal(events.length, 2);
  assert.equal(events[0].summary, "Sufi Shayari Night — Awaaz Collective");
  assert.equal(events[0].location, "The Workshop Cafe, Koregaon Park, Pune");
  assert.match(events[0].description, /doors 7 pm/);
  assert.equal(events[1].uid, "evt-2@example");
});

test("dates: local wall-clock kept, UTC converted to IST", () => {
  assert.deepEqual(icalDate("20261115T193000"), { date: "2026-11-15", time: "19:30" });
  assert.deepEqual(icalDate("20261120T143000Z"), { date: "2026-11-20", time: "20:00" });
  assert.deepEqual(icalDate("20261115"), { date: "2026-11-15", time: "" });
  assert.deepEqual(icalDate(""), { date: "", time: "" });
});

test("price inference separates free entry from paid tickets", () => {
  assert.deepEqual(inferPrice("Free entry, doors 7pm"), { is_free: 1, price_inr: 0 });
  assert.deepEqual(inferPrice("Tickets from ₹499"), { is_free: 0, price_inr: 499 });
  assert.deepEqual(inferPrice("No cover"), { is_free: 1, price_inr: 0 });
  assert.deepEqual(inferPrice("Live music tonight"), { is_free: 0, price_inr: 0 });
});

test("event mapping produces a bookable-style show row", () => {
  const [ev] = parseIcal(ICS);
  const show = mapIcalEvent(ev, { defaultCity: "Pune", sourceUrl: "https://feeds.example/e.ics" });
  assert.equal(show.title, "Sufi Shayari Night — Awaaz Collective");
  assert.equal(show.city, "Pune");
  assert.equal(show.venue, "The Workshop Cafe");
  assert.equal(show.date, "2026-11-15");
  assert.equal(show.start_time, "19:30");
  assert.equal(show.is_free, 1);
  assert.match(show.performers, /Awaaz Collective/);
  assert.equal(show.source, "ical");
  assert.equal(show.external_id, "evt-1@example");

  const [, ev2] = parseIcal(ICS);
  const mumbai = mapIcalEvent(ev2, { defaultCity: "Pune" });
  assert.equal(mumbai.city, "Mumbai");
  assert.equal(mumbai.area, "Bandra");
  assert.equal(mumbai.price_inr, 499);
  assert.equal(mumbai.start_time, "20:00");
});

test("RSS items only become shows when a real event date is present", () => {
  const xml = `<rss><channel>
    <item><title>Sufi Night at Cafe Tisserie, Pune</title><link>https://ex/1</link>
      <description>12 Nov 2026 · with Awaaz Collective, ₹300</description></item>
    <item><title>A blog post with no date</title><link>https://ex/2</link><description>Thoughts.</description></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  const show = mapRssItem(items[0], { defaultCity: "Pune" });
  assert.equal(show.date, "2026-11-12");
  assert.equal(show.city, "Pune");
  assert.equal(show.price_inr, 300);
  assert.match(show.performers, /Awaaz Collective/);
  assert.equal(mapRssItem(items[1], { defaultCity: "Pune" }), null);
  assert.equal(extractEventDate("30th Oct 2026"), "2026-10-30");
  assert.equal(extractEventDate("2026-12-01"), "2026-12-01");
});

test("daily feed run creates then updates without duplicates", async () => {
  const env = makeEnv({ FEED_ICAL_URLS: "https://feeds.example/events.ics" });
  await ensureShowSchema(env);
  const fetchImpl = mockFetch([[/feeds\.example\/events\.ics/, () => new Response(ICS, { status: 200 })]]);

  const first = await runShowFeed(env, { fetchImpl, trigger: "manual", silent: true });
  assert.equal(first.ok, true);
  assert.equal(first.created, 2);
  const rows = (await env.DB.prepare("SELECT * FROM shows ORDER BY date").all()).results;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].city, "Pune");

  const second = await runShowFeed(env, { fetchImpl, trigger: "manual", silent: true });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 2);
  const count = await env.DB.prepare("SELECT COUNT(*) n FROM shows").first();
  assert.equal(count.n, 2);
});

test("manual shows written by hosts are never clobbered by the feed", async () => {
  const env = makeEnv();
  await ensureShowSchema(env);
  await env.DB.prepare(`INSERT INTO shows (id, creator_id, title, venue, city, date, is_free, price_inr)
    VALUES ('manual1','u1','My House Show','Home','Pune','2026-12-01',1,0)`).run();
  const r = await upsertShow(env.DB, {
    title: "My House Show", venue: "Home", city: "Pune", date: "2026-12-01",
    dedupe_key: "k:my-house-show|2026-12-01|home", source: "ical", is_free: 0, price_inr: 500,
  }, { source: "ical" });
  assert.equal(r.created, false, "same show key should update not duplicate");
  const row = await env.DB.prepare("SELECT * FROM shows WHERE id = 'manual1'").first();
  assert.equal(row.source, "manual", "manual attribution preserved");
});
