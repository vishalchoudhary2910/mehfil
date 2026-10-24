import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, mockFetch, json, ARTIST_DDL } from "./helpers.mjs";
import {
  ensureTalentSchema,
  runTalentRadar,
  claimTalent,
  mapMbArtist,
  mapYtChannel,
  extractPerformers,
  upsertTalent,
  shapeTalent,
} from "../worker/talent.js";
import { mapWikiPage } from "../worker/wikisource.js";

const env = makeEnv();
env.DB.exec(ARTIST_DDL);
await ensureTalentSchema(env);

const search = () => json({
  count: 2,
  artists: [
    { id: "mb1", name: "Adi Agashé", type: "Person", area: { name: "Pune" }, tags: [{ name: "singer-songwriter" }], "life-span": { begin: "1997-06-10" } },
    { id: "mb2", name: "Awaaz Collective", type: "Group", area: { name: "Pune" }, tags: [{ name: "poetry" }, { name: "urdu" }] },
  ],
});

const detail = (id) => json(id === "mb1" ? {
  id: "mb1",
  tags: [{ name: "singer" }, { name: "indie" }],
  relations: [
    { type: "official homepage", url: { resource: "https://adi.example" } },
    { type: "social network", url: { resource: "https://instagram.com/adiagase" } },
  ],
} : {
  id: "mb2",
  tags: [{ name: "poetry" }, { name: "spoken word" }],
  relations: [{ type: "social network", url: { resource: "https://instagram.com/awaaz.shayari" } }],
});

// A fresh Response per call: bodies are single-use.
const fetchImpl = mockFetch([
  [/\/ws\/2\/artist\?/, () => search()],
  [/\/ws\/2\/artist\/mb1\?/, () => detail("mb1")],
  [/\/ws\/2\/artist\/mb2\?/, () => detail("mb2")],
]);

test("radar maps, dedupes and refreshes real MusicBrainz artists", async () => {
  const first = await runTalentRadar(env, {
    fetchImpl, cities: "Pune", categories: "singer", maxQueries: 1, detailLimit: 2, detailDelayMs: 0, wiki: false, silent: true,
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, 2);
  assert.equal(first.fetched, 2);

  const rows = (await env.DB.prepare("SELECT * FROM talent_directory ORDER BY name").all()).results;
  assert.equal(rows.length, 2);
  const adi = rows.find((r) => r.name === "Adi Agashé");
  assert.equal(adi.category, "singer");
  assert.equal(adi.city, "Pune");
  assert.equal(adi.verification, "verified");
  assert.match(adi.bio, /singer/i);
  const links = JSON.parse(adi.links);
  assert.equal(links.instagram, "adiagase");
  assert.equal(links.website, "https://adi.example");

  const awaaz = rows.find((r) => r.name === "Awaaz Collective");
  assert.equal(awaaz.category, "poet");

  const second = await runTalentRadar(env, {
    fetchImpl, cities: "Pune", categories: "singer", maxQueries: 1, detailLimit: 2, detailDelayMs: 0, wiki: false, silent: true,
  });
  assert.equal(second.created, 0);
  assert.equal(second.refreshed, 2);
  const count = await env.DB.prepare("SELECT COUNT(*) n FROM talent_directory").first();
  assert.equal(count.n, 2);
});

test("one-click claim creates a quote-per-gig profile and locks the entry", async () => {
  await env.DB.prepare("INSERT INTO users (id, auth_sub, name, email) VALUES (?,?,?,?)").bind("u1", "sub1", "Awaaz", "awaaz@example.com").run();
  const row = await env.DB.prepare("SELECT * FROM talent_directory WHERE name = 'Awaaz Collective'").first();
  const r = await claimTalent(env.DB, { id: "u1" }, row.slug);
  assert.ok(r.artist, JSON.stringify(r));
  assert.equal(r.artist.stage_name, "Awaaz Collective");
  assert.equal(r.artist.category, "poet");
  assert.equal(r.artist.base_price_inr, 0, "claim publishes quote-per-gig, no packages required");
  assert.equal(r.artist.directory_id, row.id);

  const dir = await env.DB.prepare("SELECT * FROM talent_directory WHERE id = ?").bind(row.id).first();
  assert.equal(dir.status, "claimed");
  assert.equal(dir.claimed_artist_id, r.artist.id);

  // Re-claiming the same entry is refused with the existing slug.
  const again = await claimTalent(env.DB, { id: "u1" }, row.slug);
  assert.equal(again.error[0], 409);
});

test("claimed profiles survive the daily refresh untouched", async () => {
  await runTalentRadar(env, {
    fetchImpl, cities: "Pune", categories: "singer", maxQueries: 1, detailLimit: 2, detailDelayMs: 0, wiki: false, silent: true,
  });
  const dir = await env.DB.prepare("SELECT * FROM talent_directory WHERE name = 'Awaaz Collective'").first();
  assert.equal(dir.status, "claimed");
  assert.equal(dir.claimed_artist_id != null, true);
});

test("unseen entries go stale and are never counted as fresh", async () => {
  await env.DB.prepare("UPDATE talent_directory SET last_seen_at = datetime('now','-50 day') WHERE status = 'active'").run();
  const empty = mockFetch([[/\/ws\/2\/artist\?/, () => json({ artists: [] })]]);
  const r = await runTalentRadar(env, {
    fetchImpl: empty, cities: "Pune", categories: "singer", maxQueries: 1, detailLimit: 0, detailDelayMs: 0, wiki: false, silent: true,
  });
  assert.ok(r.stale >= 1, `stale=${r.stale}`);
  const stale = await env.DB.prepare("SELECT COUNT(*) n FROM talent_directory WHERE status='stale'").first();
  assert.ok(stale.n >= 1);
});

test("YouTube channels and event performers map to directory entries", () => {
  const yt = mapYtChannel(
    { id: { channelId: "yt1" }, snippet: { title: "Pune Sufi Collective", description: "Live qawwali in Pune", thumbnails: { medium: { url: "https://img/x.jpg" } } } },
    { city: "Pune", category: "band", followers: 1200 }
  );
  assert.equal(yt.name, "Pune Sufi Collective");
  assert.equal(yt.city, "Pune");
  assert.equal(yt.followers, 1200);
  assert.equal(yt.links.youtube, "https://www.youtube.com/channel/yt1");

  const names = extractPerformers("Lineup: Awaaz Collective, Kabir Vani and DJ Reet — free entry");
  assert.deepEqual(names, ["Awaaz Collective", "Kabir Vani", "DJ Reet"]);
  assert.deepEqual(extractPerformers("Open mic night, open signup"), []);
});

test("the searched category is a hint only when MusicBrainz matched it", async () => {
  const env2 = makeEnv();
  env2.DB.exec(ARTIST_DDL);
  await ensureTalentSchema(env2);

  // Tag query returns nothing, so the radar falls back to the city. The act is
  // real and in the city, but nothing proves it is a poet.
  const fallbackOnly = mockFetch([
    [/tag%3A/, () => json({ artists: [] })],
    [/\/ws\/2\/artist\?/, () => json({ artists: [{ id: "p1", name: "City Act", type: "Person", area: { name: "Pune" } }] })],
    [/\/ws\/2\/artist\/p1\?/, () => json({ id: "p1", tags: [], relations: [] })],
  ]);
  await runTalentRadar(env2, {
    fetchImpl: fallbackOnly, cities: "Pune", categories: "poet", maxQueries: 1, detailLimit: 1, detailDelayMs: 0, wiki: false, silent: true,
  });
  const row = await env2.DB.prepare("SELECT category FROM talent_directory WHERE name = 'City Act'").first();
  assert.equal(row.category, "other");

  // Same act, but now the tag query itself matched — the hint is legitimate.
  const tagged = mockFetch([
    [/tag%3A/, () => json({ artists: [{ id: "p2", name: "Tagged Shayar", type: "Person", area: { name: "Pune" } }] })],
    [/\/ws\/2\/artist\/p2\?/, () => json({ id: "p2", tags: [], relations: [] })],
  ]);
  await runTalentRadar(env2, {
    fetchImpl: tagged, cities: "Pune", categories: "poet", maxQueries: 1, detailLimit: 1, detailDelayMs: 0, wiki: false, silent: true,
  });
  const taggedRow = await env2.DB.prepare("SELECT category FROM talent_directory WHERE name = 'Tagged Shayar'").first();
  assert.equal(taggedRow.category, "poet");
});

test("MB mapping keeps attribution and a usable bio", () => {
  const m = mapMbArtist(
    { id: "x", name: "Bela Shende", type: "Person", area: { name: "Pune" }, disambiguation: "Indian playback singer", "life-span": { begin: "1975" } },
    { city: "Pune", detail: { tags: [{ name: "playback" }], relations: [] } }
  );
  assert.equal(m.category, "singer");
  assert.match(m.bio, /playback/i);
  assert.equal(m.source, "musicbrainz");
  assert.equal(m.source_url, "https://musicbrainz.org/artist/x");
  assert.equal(m.verification, "listed");
});

test("Wikipedia maps real living profiles and never invents a city", () => {
  const page = {
    pageid: 7311,
    title: "Aparna Lanjewar Bose",
    description: "Indian poet and writer",
    extract: "Aparna Lanjewar Bose is an Indian poet from Pune. She writes in Marathi and English.",
    thumbnail: { source: "https://img.example/aparna.jpg?utm_source=en.wikipedia.org" },
    fullurl: "https://en.wikipedia.org/wiki/Aparna_Lanjewar_Bose",
    extlinks: [{ "*": "https://instagram.com/aparna.poet" }, { "*": "https://aparna.example/about" }],
  };
  const m = mapWikiPage(page, { city: "Pune", category: "poet", matchedCategory: "Indian poets" });
  assert.equal(m.name, "Aparna Lanjewar Bose");
  assert.equal(m.category, "poet");
  assert.equal(m.city, "Pune");
  assert.equal(m.source, "wikipedia");
  assert.match(m.source_url, /wikipedia\.org/);
  assert.equal(m.links.instagram.includes("instagram.com"), true);
  assert.equal(m.links.website, "https://aparna.example/about");
  assert.equal(m.image_url.includes("utm_source"), false);
  assert.ok(m.languages.includes("Marathi"));

  // A profile whose intro never names the city must stay city-less instead of
  // being filed under the city we happened to search.
  const noCity = mapWikiPage({ ...page, pageid: 7999, extract: "A poet writing in Urdu and Hindi." }, { city: "Pune", category: "poet" });
  assert.equal(noCity.city, "");

  // Deceased artists and list pages never enter a hiring directory.
  assert.equal(mapWikiPage({ ...page, description: "Indian poet (1964–2019)" }, { category: "poet" }), null);
  assert.equal(mapWikiPage({ ...page, title: "List of Indian poets" }, { category: "poet" }), null);
});

test("Wikipedia is a first-class radar source for poets", async () => {
  const env3 = makeEnv();
  env3.DB.exec(ARTIST_DDL);
  await ensureTalentSchema(env3);
  const page = {
    pageid: 4444,
    title: "Naya Shayar",
    description: "Indian poet from Pune",
    extract: "Naya Shayar is an Urdu poet who performs mushairas in Pune.",
    thumbnail: { source: "https://img.example/naya.jpg" },
    fullurl: "https://en.wikipedia.org/wiki/Naya_Shayar",
    extlinks: [{ "*": "https://instagram.com/nayashayar" }],
  };
  const fetchImpl = mockFetch([
    [/musicbrainz\.org/, () => json({ artists: [] })],
    [/en\.wikipedia\.org/, () => json({ query: { pages: [page, { pageid: 1, title: "List of poets" }] } })],
  ]);
  const r = await runTalentRadar(env3, {
    fetchImpl, cities: "Pune", categories: "poet", maxQueries: 1, detailLimit: 0,
    detailDelayMs: 0, wiki: true, wikiRefreshLimit: 0, silent: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.created, 1, JSON.stringify(r));
  const row = await env3.DB.prepare("SELECT * FROM talent_directory WHERE source='wikipedia'").first();
  assert.equal(row.name, "Naya Shayar");
  assert.equal(row.category, "poet");
  assert.equal(row.city, "Pune");
  assert.equal(row.open_to_work, 0);
});

test("self-registration publishes an open-to-work profile", async () => {
  const env4 = makeEnv();
  env4.DB.exec(ARTIST_DDL);
  await ensureTalentSchema(env4);
  const r = await upsertTalent(env4.DB, {
    name: "Local Loop", category: "rapper", city: "Pune", area: "Kothrud",
    bio: "Marathi hip-hop, two EPs out.", links: { instagram: "@localloop" }, open_to_work: true,
    source: "claim", verification: "self",
  }, { source: "claim" });
  assert.equal(r.created, true);
  assert.equal(r.talent.source, "claim");
  assert.equal(r.talent.verification, "self");
  assert.equal(r.talent.open_to_work, 1);
  const shaped = shapeTalent(r.talent);
  assert.equal(shaped.open_to_work, true);
  assert.equal(shaped.links.instagram, "localloop");
});

test("Wikipedia rejects the wrong discipline and trusts a city category", () => {
  const scholar = {
    pageid: 9001, title: "Scholar Saheb", description: "Islamic scholar and educator",
    extract: "Scholar Saheb is an Islamic scholar and educator based in Delhi.", fullurl: "https://en.wikipedia.org/wiki/X",
  };
  assert.equal(mapWikiPage(scholar, { category: "poet" }), null);

  const poet = mapWikiPage(
    { pageid: 9002, title: "Mumbai Shayar", description: "Indian poet", extract: "A poet writing in Urdu." },
    { category: "poet", cityFromCategory: "Mumbai" }
  );
  assert.equal(poet.city, "Mumbai");
  assert.equal(poet.category, "poet");
});

test("Wikipedia genre tags use whole words and do not invent a rap career", () => {
  const dancer = mapWikiPage(
    {
      pageid: 9100,
      title: "Prabha Example",
      description: "Indian dancer and choreographer",
      extract: "Prabha Example is an Indian dancer and choreographer known for kathak and Bharatanatyam.",
      fullurl: "https://en.wikipedia.org/wiki/Prabha_Example",
    },
    { category: "dancer", city: "Pune" }
  );
  assert.equal(dancer.category, "dancer");
  assert.equal(dancer.genres.includes("rap"), false, JSON.stringify(dancer.genres));
  assert.ok(dancer.genres.includes("kathak"));
});

test("the same act from two sources becomes one directory row", async () => {
  const env5 = makeEnv();
  env5.DB.exec(ARTIST_DDL);
  await ensureTalentSchema(env5);

  await upsertTalent(
    env5.DB,
    {
      name: "Dream Note (Indian band)", category: "band", city: "Jaipur",
      bio: "Indie-pop duo.", image_url: "https://img.example/dream.jpg",
      links: { instagram: "@dreamnote" }, source: "wikipedia",
      source_url: "https://en.wikipedia.org/wiki/Dream_Note_(Indian_band)",
      external_id: "wiki:1", verification: "listed",
    },
    { source: "wikipedia" }
  );
  await upsertTalent(
    env5.DB,
    {
      name: "Dream Note", category: "band", city: "Jaipur",
      bio: "Indie-pop duo from Jaipur, formed 2014.", source: "musicbrainz",
      source_url: "https://musicbrainz.org/artist/x", external_id: "mb:x",
      verification: "verified",
    },
    { source: "musicbrainz" }
  );

  const rows = (await env5.DB.prepare("SELECT * FROM talent_directory").all()).results;
  assert.equal(rows.length, 1, JSON.stringify(rows.map((r) => r.name)));
  assert.match(rows[0].bio, /formed 2014/);
  assert.equal(JSON.parse(rows[0].links).instagram, "dreamnote");
  assert.equal(rows[0].image_url, "https://img.example/dream.jpg");
});

test("public profile shapes never expose an artist's private contact", async () => {
  const env6 = makeEnv();
  env6.DB.exec(ARTIST_DDL);
  await ensureTalentSchema(env6);
  const r = await upsertTalent(env6.DB, {
    name: "Private Poet", category: "poet", city: "Pune",
    email: "poet@example.com", phone: "9876543210", source: "claim", verification: "self",
  }, { source: "claim" });
  const shaped = shapeTalent(r.talent);
  assert.equal(shaped.has_contact, true);
  assert.equal(shaped.email, undefined);
  assert.equal(shaped.phone, undefined);
});
