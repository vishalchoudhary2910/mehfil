import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCategory,
  inferCategoryFromTags,
  categoriesForVenue,
  distanceKm,
  cityCoords,
  inferCity,
  CATEGORY_KEYS,
} from "../shared/categories.js";
import { matchScore } from "../worker/leadsource.js";

test("poets and shayars are first-class categories", () => {
  assert.equal(normalizeCategory("shayar"), "poet");
  assert.equal(normalizeCategory("Urdu poetry night"), "poet");
  assert.equal(normalizeCategory("spoken word"), "poet");
  assert.equal(normalizeCategory("stand-up comic"), "comedian");
  assert.equal(normalizeCategory("kathak dancer"), "dancer");
  assert.equal(normalizeCategory("dhol player"), "dhol");
  assert.equal(normalizeCategory("tabla player"), "instrumentalist");
  assert.equal(normalizeCategory("sufi singer"), "singer");
  assert.equal(normalizeCategory("qawwali group"), "band");
  assert.equal(normalizeCategory("magician"), "magician");
  assert.equal(normalizeCategory("dastangoi"), "storyteller");
  assert.equal(normalizeCategory("singer-songwriter"), "singer");
  assert.equal(normalizeCategory("rapper"), "rapper");
  assert.equal(normalizeCategory("desi hip hop"), "rapper");
  assert.ok(CATEGORY_KEYS.includes("poet"));
  assert.ok(CATEGORY_KEYS.includes("rapper"));
  // A stage name starting with "MC" is not an anchor just because of that.
  assert.equal(normalizeCategory("", "MC STAN"), "other");
});

test("category inference from source tags handles sparse data", () => {
  assert.equal(inferCategoryFromTags(["poetry", "urdu"], "Awaaz", "Group"), "poet");
  assert.equal(inferCategoryFromTags([], "Neon Qisse", "Group"), "band");
  assert.equal(inferCategoryFromTags(["sufi", "vocal"], "Ritviz", "Person"), "singer");
  // Catalogue genre tags: a lo-fi beatmaker is hired as a DJ, not an
  // instrumentalist, and filmi/bollywood tags mean a singer.
  assert.equal(inferCategoryFromTags(["instrumental hip hop", "lo-fi"], "Ritviz", "Person"), "dj");
  assert.equal(inferCategoryFromTags(["filmi", "bollywood", "indian pop"], "Asha", "Person"), "singer");
  assert.equal(inferCategoryFromTags(["mushaira", "urdu"], "Sukhan", "Person"), "poet");
  assert.equal(inferCategoryFromTags(["ambient", "downtempo"], "4lienetic", "Person"), "dj");
  assert.equal(inferCategoryFromTags(["hip hop", "rap"], "MC STAN", "Person"), "rapper");
  assert.equal(inferCategoryFromTags(["instrumental hip hop"], "Producer", "Person"), "dj");
  // Nothing conclusive stays "other" rather than being guessed.
  assert.equal(inferCategoryFromTags([], "Ankur Tewari", ""), "other");
});

test("venue demand resolves to the right talent categories", () => {
  assert.deepEqual(categoriesForVenue("poetry cafe"), ["poet", "storyteller", "singer"]);
  assert.ok(categoriesForVenue("comedy club").includes("comedian"));
  assert.ok(categoriesForVenue("wedding banquet").includes("dhol"));
  assert.ok(categoriesForVenue("corporate").includes("anchor"));
  assert.deepEqual(categoriesForVenue("space station"), []);
});

test("city distance and inference", () => {
  const km = distanceKm(cityCoords("Pune"), cityCoords("Mumbai"));
  assert.ok(km > 100 && km < 180, `expected ~120-160km, got ${km}`);
  assert.equal(distanceKm(null, [1, 2]), null);
  assert.equal(inferCity("The Workshop Cafe, Koregaon Park, Pune", ""), "Pune");
  assert.equal(inferCity("no idea", "Jaipur"), "Jaipur");
});

test("lead match score supports poets and nearby cities", () => {
  const poet = { category: "poet", city: "Pune", area: "Kothrud", verification: "verified", wants_artists: 1, rating: 4.5 };
  const poetArtist = { category: "poet", city: "Pune", area: "Kothrud", travel_radius_km: 30 };
  const scored = matchScore(poet, poetArtist);
  assert.ok(scored.score >= 80, JSON.stringify(scored.reasons));
  assert.ok(scored.reasons.includes("poet fits poet"));

  const mumbaiArtist = { category: "poet", city: "Mumbai", travel_radius_km: 200 };
  const near = matchScore(poet, mumbaiArtist);
  assert.ok(near.score > 0, "a 150km artist with a 200km radius should match");
  const far = matchScore(poet, { ...mumbaiArtist, travel_radius_km: 20 });
  assert.equal(far.score, 0);
});
