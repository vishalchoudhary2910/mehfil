// Server-injected share previews for the SPA's public pages.
//
// A React SPA ships one index.html, so every link used to preview the same
// generic card on WhatsApp, X, LinkedIn and Reddit — the exact places artists
// and hosts share profiles. These routes answer with the real app shell but
// rewrite the head with that artist's name, city, price and a canonical URL,
// so a shared link is an advertisement instead of a dead end. Crawlers that
// don't run JavaScript still get the title, description and Person JSON-LD.
import { categoryLabel } from "../shared/categories.js";
import { ldJson } from "./security.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

const originOf = (env, request) => {
  const configured = String(env.APP_ORIGIN || "").replace(/\/$/, "");
  return configured || new URL(request.url).origin;
};

// Remove the shell's defaults so a page never carries two conflicting titles.
function stripMeta(html) {
  return String(html)
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[^>]*>/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, "");
}

export function injectMeta(html, meta) {
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.desc)}">`,
    meta.canonical ? `<link rel="canonical" href="${esc(meta.canonical)}">` : "",
    `<meta property="og:type" content="${esc(meta.type || "website")}">`,
    `<meta property="og:site_name" content="Mehfil">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.desc)}">`,
    meta.canonical ? `<meta property="og:url" content="${esc(meta.canonical)}">` : "",
    `<meta property="og:image" content="${esc(meta.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt || meta.title)}">`,
    `<meta property="og:locale" content="en_IN">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.desc)}">`,
    `<meta name="twitter:image" content="${esc(meta.image)}">`,
    meta.jsonld ? ldJson(meta.jsonld) : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  const out = stripMeta(html).replace(/<\/head>/i, `  ${tags}\n  </head>`);
  return out;
}

export function artistMeta(artist, origin) {
  const cat = categoryLabel(artist.category) || "Artist";
  const where = [artist.area, artist.city].filter(Boolean).join(", ");
  const name = artist.stage_name || "Artist";
  const price = Number(artist.base_price_inr) || 0;
  const rating = Number(artist.rating) || 0;
  const reviews = Number(artist.reviews_count) || 0;
  const proof = rating && reviews ? `${rating.toFixed(1)}★ from ${reviews} reviews. ` : "";
  const bio = artist.tagline || artist.bio || "";
  const desc = clip(
    `${proof}Book ${name} — ${cat.toLowerCase()} in ${where || "India"}` +
      (price ? `, packages from ${inr(price)}` : "") +
      `. Verified profile, escrow-protected booking, real availability.` +
      (bio ? ` ${bio}` : ""),
    200
  );
  const title = clip(`${name} — ${cat} in ${artist.city || "India"} | Mehfil`, 68);
  const canonical = `${origin}/artist/${encodeURIComponent(artist.slug)}`;
  const image = `${origin}/og-cover.png`;
  return {
    title,
    desc,
    canonical,
    image,
    type: "profile",
    imageAlt: `${name} on Mehfil`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Person",
      name,
      jobTitle: cat,
      url: canonical,
      image,
      description: clip(bio, 300) || desc,
      address: artist.city
        ? { "@type": "PostalAddress", addressLocality: artist.city, addressCountry: "IN" }
        : undefined,
      ...(rating && reviews
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: rating,
              reviewCount: reviews,
              bestRating: 5,
            },
          }
        : {}),
      ...(price
        ? {
            makesOffer: {
              "@type": "Offer",
              price: price,
              priceCurrency: "INR",
              availability: "https://schema.org/InStock",
              url: canonical,
            },
          }
        : {}),
    },
  };
}

export function talentMeta(person, origin) {
  const cat = categoryLabel(person.category) || "Performer";
  const where = [person.area, person.city].filter(Boolean).join(", ");
  const name = person.name || "Artist";
  const desc = clip(
    `${name} — ${cat.toLowerCase()}${where ? ` in ${where}` : ""} on Mehfil. ` +
      `${clip(person.bio, 90) || "Public profile assembled from attributed listings."} ` +
      `Claim this profile free to add rates, a showreel and gig requests.`,
    200
  );
  const canonical = `${origin}/talent/${encodeURIComponent(person.slug)}`;
  const image = `${origin}/og-cover.png`;
  return {
    title: clip(`${name} — ${cat} in ${person.city || "India"} | Mehfil`, 68),
    desc,
    canonical,
    image,
    type: "profile",
    imageAlt: `${name} on Mehfil`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Person",
      name,
      jobTitle: cat,
      url: canonical,
      image,
      description: clip(person.bio, 300) || desc,
      address: person.city
        ? { "@type": "PostalAddress", addressLocality: person.city, addressCountry: "IN" }
        : undefined,
    },
  };
}

export function mountShareRoutes(app) {
  const html = async (c, meta) => {
    const url = new URL(c.req.url);
    const shell = await c.env.ASSETS.fetch(
      new Request(new URL("/index.html", url.origin), { headers: c.req.raw.headers })
    ).catch(() => null);
    if (!shell || !shell.ok) return c.notFound();
    const body = injectMeta(await shell.text(), meta);
    return new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Short cache: a rename or price change should show up fast, while
        // keeping repeat reads off D1 for the crawlers that hammer profiles.
        "Cache-Control": "public, max-age=300, s-maxage=600",
        Vary: "Accept-Encoding",
      },
    });
  };

  app.get("/artist/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!/^[a-z0-9-]{1,80}$/i.test(slug)) return c.notFound();
    const artist = await c.env.DB.prepare(
      `SELECT slug, stage_name, category, city, area, tagline, bio, base_price_inr,
              rating, reviews_count, gigs_done, verified, hue
       FROM artist_profiles WHERE slug = ?`
    )
      .bind(slug)
      .first()
      .catch(() => null);
    if (!artist) return c.notFound();
    return html(c, artistMeta(artist, originOf(c.env, c.req.raw)));
  });

  app.get("/talent/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!/^[a-z0-9-]{1,80}$/i.test(slug)) return c.notFound();
    const person = await c.env.DB.prepare(
      `SELECT slug, name, category, city, area, bio
       FROM talent_directory WHERE slug = ?`
    )
      .bind(slug)
      .first()
      .catch(() => null);
    if (!person) return c.notFound();
    return html(c, talentMeta(person, originOf(c.env, c.req.raw)));
  });
}

