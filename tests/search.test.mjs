import test from "node:test";
import assert from "node:assert/strict";
import {
  textScore,
  buildDemand,
  scoreItem,
  rankItems,
  shapeItem,
  interestSummary,
} from "../worker/search.js";

const poet = {
  id: "td1", slug: "awaaz", name: "Awaaz Collective", category: "poet", city: "Pune",
  bio: "Sufi shayari in Urdu and Hindi", genres: "[\"Urdu Shayari\",\"Sufi\"]", languages: "[\"Hindi\",\"Urdu\"]",
  links: "{\"instagram\":\"awaaz.shayari\"}", verification: "listed", open_to_work: 1,
  last_seen_at: "2026-10-20 10:00:00", followers: 0, source: "wikipedia",
};
const comic = {
  id: "td2", slug: "hanso", name: "Hanso Club", category: "comedian", city: "Mumbai",
  bio: "Stand-up comedy in Hindi", genres: "[]", languages: "[\"Hindi\"]",
  links: "{}", verification: "verified", open_to_work: 0, last_seen_at: "2024-01-01 00:00:00",
  followers: 0, source: "wikipedia",
};
const bookable = {
  id: "a1", slug: "kabir", stage_name: "Kabir Vani", category: "poet", city: "Pune",
  bio: "Ghazal and shayari for intimate evenings", sub_skills: "[\"Ghazal\"]", languages: "[\"Hindi\"]",
  rating: 4.8, reviews_count: 12, base_price_inr: 8000, available_now: 1, accepting_requests: 1,
  verified: 1, followers: 0, created_at: "2026-10-01 00:00:00",
};

test("free-text search hits names, genres and bios without noise", () => {
  assert.ok(textScore("Awaaz", shapeItem(poet, "directory")) > textScore("shayari", shapeItem(poet, "directory")));
  assert.ok(textScore("shayari", shapeItem(poet, "directory")) > 0);
  assert.equal(textScore("space station", shapeItem(poet, "directory")), 0);
  assert.equal(textScore("", shapeItem(poet, "directory")), 0);
});

test("filters are hard, text is soft, and city matching is case-insensitive", () => {
  const all = rankItems([bookable], [poet, comic], {});
  assert.equal(all.length, 3);
  const mumbai = rankItems([bookable], [poet, comic], { city: "mumbai" });
  assert.deepEqual(mumbai.map((r) => r.name), ["Hanso Club"]);
  const poetry = rankItems([bookable], [poet, comic], { category: "poet" });
  assert.equal(poetry.every((r) => r.category === "poet"), true);
  assert.deepEqual(rankItems([bookable], [poet, comic], { q: "no such act" }), []);
});

test("interest and freshness break ties, and the reasons are explicit", () => {
  const demand = buildDemand(
    [{ category: "poet", city: "Pune", n: 4 }],
    [{ category: "Comedian", city: "Mumbai", n: 1 }]
  );
  const ranked = rankItems([bookable], [poet, comic], { demand });
  const first = ranked[0];
  assert.equal(first.name, "Kabir Vani", JSON.stringify(ranked.map((r) => [r.name, r.score])));
  assert.ok(first.reasons.some((r) => r.includes("open request")));

  const cold = scoreItem(shapeItem(comic, "directory"), { demand: {} });
  const warm = scoreItem(shapeItem(comic, "directory"), { demand });
  assert.ok(warm.score > cold.score);
  assert.equal(scoreItem(shapeItem(comic, "directory"), { category: "poet" }), null);
});

test("claimed profiles supersede their unclaimed directory duplicate", () => {
  const dir = { ...poet, name: "Kabir Vani", slug: "kabir-vani-dir" };
  const ranked = rankItems([bookable], [dir], {});
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].kind, "artist");
});

test("demand summary is usable by the UI", () => {
  const demand = buildDemand(
    [{ category: "poet", city: "Pune", n: 3 }, { category: "poet", city: "Pune", n: 1 }],
    []
  );
  assert.equal(demand["poet|pune"], 4);
  assert.deepEqual(interestSummary(demand)[0], { category: "poet", city: "pune", n: 4 });
});

test("intent words find the right category even when the bio never says it", () => {
  const quietPoet = {
    ...poet, id: "td3", slug: "quiet", name: "Quiet Verse", bio: "Urdu verse for mehfils",
    genres: "[]", languages: "[\"Urdu\"]", open_to_work: 0,
  };
  const ranked = rankItems([], [quietPoet], { q: "shayari" });
  assert.equal(ranked.length, 1, JSON.stringify(ranked));
  assert.equal(ranked[0].category, "poet");
  assert.equal(rankItems([], [quietPoet], { q: "stand-up" }).length, 0);
});
