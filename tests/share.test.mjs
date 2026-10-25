import test from "node:test";
import assert from "node:assert/strict";
import { injectMeta, artistMeta, talentMeta } from "../worker/share.js";

const ORIGIN = "https://mehfil.in";

test("artist metadata names the act, city and starting price", () => {
  const meta = artistMeta(
    {
      slug: "dj-arjun-pune",
      stage_name: "DJ Arjun",
      category: "dj",
      city: "Pune",
      area: "Koregaon Park",
      tagline: "Open-format sets for private parties",
      base_price_inr: 12000,
      rating: 4.8,
      reviews_count: 24,
    },
    ORIGIN
  );
  assert.match(meta.title, /DJ Arjun/);
  assert.match(meta.title, /Pune/);
  assert.equal(meta.canonical, `${ORIGIN}/artist/dj-arjun-pune`);
  assert.match(meta.desc, /₹12,000/);
  assert.equal(meta.image, `${ORIGIN}/og-cover.png`);
  assert.equal(meta.jsonld["@type"], "Person");
  assert.equal(meta.jsonld.aggregateRating.ratingValue, 4.8);
  assert.equal(meta.jsonld.makesOffer.price, 12000);
});

test("injectMeta replaces shell defaults and keeps the app bootable", () => {
  const shell =
    `<!doctype html><html><head><title>Mehfil — Hire</title>` +
    `<meta name="description" content="old">` +
    `<meta property="og:title" content="old">` +
    `</head><body><div id="root"></div>` +
    `<script type="module" src="/src/main.jsx"></script></body></html>`;
  const out = injectMeta(
    shell,
    artistMeta(
      {
        slug: "x",
        stage_name: "A <script>alert(1)</script>",
        category: "singer",
        city: "Mumbai",
        base_price_inr: 0,
      },
      ORIGIN
    )
  );
  assert.equal((out.match(/<title>/g) || []).length, 1, "one title only");
  assert.ok(!out.includes("<script>alert(1)</script>"), "names are escaped");
  assert.ok(out.includes('property="og:image"'));
  assert.ok(out.includes(`${ORIGIN}/artist/x`));
  assert.ok(out.includes('id="root"'), "React still mounts");
  assert.ok(out.includes("/src/main.jsx"), "the module entry survives");
});

test("talent metadata invites a claim without inventing a price", () => {
  const meta = talentMeta(
    { slug: "fanindra-bhardwaj", name: "Fanindra Bhardwaj", category: "rapper", city: "Jaipur", bio: "Rapper from Jaipur." },
    ORIGIN
  );
  assert.match(meta.title, /Fanindra Bhardwaj/);
  assert.equal(meta.canonical, `${ORIGIN}/talent/fanindra-bhardwaj`);
  assert.match(meta.desc, /Claim this profile/);
  assert.equal(meta.jsonld.makesOffer, undefined);
  assert.doesNotMatch(meta.desc, /₹/);
});
