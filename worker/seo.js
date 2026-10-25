// Mehfil SEO landing pages — server-rendered HTML straight from D1.
// Plan (user acquisition, Step 2): "SEO pages: one page per category × city ×
// event type" — e.g. /in/pune/dj/birthday-party → "DJ for birthday party in Pune".
// Real HTML in the response body: crawlers get content without executing JS,
// and every page carries live prices + live artist availability, so the pages
// can't go stale or read as doorway copy.

export const CATEGORIES = {
  dj: { label: "DJ", plural: "DJs", icon: "🎧" },
  singer: { label: "Singer", plural: "Singers", icon: "🎤" },
  band: { label: "Live Band", plural: "Live Bands", icon: "🎸" },
  anchor: { label: "Anchor / Emcee", plural: "Anchors & Emcees", icon: "🎙️" },
};

export const CITIES = ["Pune", "Mumbai", "Jaipur"];

export const EVENTS = {
  "birthday-party": {
    label: "birthday party", title: "Birthday Party",
    tips: [
      "Lock the end time before you book — house parties and community halls usually have noise cut-offs, and a 2–4 hour set fits most birthday runs.",
      "Ask for a cake-cutting cue and a quick speech mic in the brief; most packages include a short break for exactly this.",
    ],
  },
  "kitty-party": {
    label: "kitty party", title: "Kitty Party",
    tips: [
      "Kitty parties usually run 1.5–3 hours in the afternoon or early evening; a compact speaker setup is often enough — say so in the brief to keep the price down.",
      "If games and announcements are part of the format, an anchor alongside the music keeps the run-sheet moving.",
    ],
  },
  "sangeet": {
    label: "sangeet", title: "Sangeet",
    tips: [
      "Share the family run-of-show and must-play list up front — sangeet sets live and die by the song list, and most packages include a rehearsal call.",
      "Confirm whether the package covers choreographed entries; if the family performs, the artist needs cue points, not just a playlist.",
    ],
  },
  "wedding": {
    label: "wedding", title: "Wedding",
    tips: [
      "Weddings span multiple events — baraat, sangeet, reception. Ask for a custom multi-event package instead of booking each night separately.",
      "Travel, stay and load-in windows belong in the brief; outstation artists quote them separately so nothing is surprise-priced on the day.",
    ],
  },
  "house-party": {
    label: "house party", title: "House Party",
    tips: [
      "Floor space decides speaker size — most DJs travel with a compact rig that fits an apartment, but confirm room dimensions in the brief.",
      "Building rules matter: check guest counts and parking with your society before the date, not after.",
    ],
  },
  "corporate": {
    label: "corporate event", title: "Corporate Event",
    tips: [
      "Brand guidelines, rehearsal slots and a mic for speeches go in the brief — corporate bookings live on run-sheet precision.",
      "Need a GST invoice? Business hosts get one per booking; add your GSTIN while booking.",
    ],
  },
  "college-fest": {
    label: "college fest", title: "College Fest",
    tips: [
      "Campus permissions and sound-check windows decide the day — put both in the brief so the artist plans load-in around them.",
      "Fest budgets are real: filter by price and shortlist artists whose packages already match your headcount and stage.",
    ],
  },
  "club-night": {
    label: "club night", title: "Club Night",
    tips: [
      "Confirm the soundcheck window and backline with the venue before booking; club sets hinge on the 20 minutes before doors.",
      "Weeknight residencies are cheaper than Saturday heads — if you run regular nights, mention the recurrence in the brief for a package deal.",
    ],
  },
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const SEO_CSS = `
:root{--ink:#17101f;--plum:#221530;--marigold:#f5a623;--saffron:#ff6b35;--cream:#fbf6ee;--paper:#fff;--text:#241a2e;--text2:#5d5170;--line:#e9e0d3}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 Inter,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--cream);color:var(--text)}
a{color:inherit;text-decoration:none}
header{background:radial-gradient(700px 300px at 85% -20%,#5b2a86,transparent 60%),var(--ink);color:#fff;padding:34px 0 30px}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
.nav{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:#c9bcdd}
.logo{font:700 21px Georgia,serif}.logo i{display:inline-block;width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--marigold),var(--saffron))}
h1{font:600 clamp(1.7rem,4.4vw,2.5rem)/1.15 Georgia,serif;margin:18px 0 8px}
.sub{color:#cdbfe4;max-width:640px;font-size:16.5px;margin:0 0 14px}
.pills{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:4px 12px;font-size:13px;color:#e8ddf8}
.btn{display:inline-block;background:linear-gradient(135deg,var(--marigold),var(--saffron));color:#2a1405;font-weight:700;border-radius:999px;padding:11px 22px;font-size:15px}
main{padding:26px 0 8px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:16px 0}
h2{font:600 1.35rem Georgia,serif;margin:0 0 10px}
.stats{display:flex;gap:26px;flex-wrap:wrap;margin:6px 0 4px}
.stat b{display:block;font:700 1.45rem Georgia,serif}.stat span{font-size:12.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.artist{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:13px 14px;background:#fff;transition:box-shadow .15s}
.artist:hover{box-shadow:0 6px 18px rgba(30,16,45,.1)}
.av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}
.nm{font-weight:650;display:block}.mt{font-size:12.5px;color:var(--text2);display:block}
.pr{margin-left:auto;font:600 16px Georgia,serif;white-space:nowrap}.pr small{display:block;font:400 11px Inter,sans-serif;color:var(--text2)}
ul.tips{padding-left:18px;margin:8px 0}ul.tips li{margin:6px 0;color:var(--text2)}
ol.steps{padding-left:20px;margin:8px 0}ol.steps li{margin:7px 0}
.faq{border-top:1px solid var(--line);padding:12px 0}.faq:first-of-type{border-top:none}
.faq b{display:block;margin-bottom:4px}.faq p{margin:0;color:var(--text2);font-size:15px}
.links{display:flex;flex-wrap:wrap;gap:8px}
.links a{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13.5px;background:#fff}
.links a:hover{border-color:var(--saffron)}
.empty{text-align:center;color:var(--text2)}
footer{margin-top:30px;border-top:1px solid var(--line);padding:18px 0 30px;font-size:13px;color:var(--text2)}
.crumbs{font-size:13.5px;color:var(--text2);margin-top:10px}
.crumbs a{text-decoration:underline}
`;

// Full HTML document for one SEO page.
function page({ title, desc, canonical, origin, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SEO_CSS}</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="nav"><a class="logo" href="/">Mehfil <i></i></a><a class="btn" href="${esc(body.ctaHref)}" style="padding:8px 16px;font-size:13.5px">${esc(body.ctaLabel)}</a></div>
    <h1>${esc(body.h1)}</h1>
    <p class="sub">${esc(body.sub)}</p>
    <div class="pills">${body.pills.map((p) => `<span class="pill">${esc(p)}</span>`).join("")}</div>
  </div>
</header>
<main class="wrap">
${body.sections}
</main>
<footer class="wrap">
  <div>Mehfil — hire, team up, and perform. Escrow-protected bookings for private events in India. This is a demo build: payments and payouts are simulated.</div>
  <div class="crumbs" style="margin-top:8px"><a href="/in">All city guides</a> · <a href="/">Home</a> · <a href="/discover">Browse all artists</a></div>
</footer>
${body.jsonld ? `<script type="application/ld+json">${JSON.stringify(body.jsonld)}</script>` : ""}
</body>
</html>`;
}

const CATEGORIES_LIST = Object.keys(CATEGORIES);
const EVENTS_LIST = Object.keys(EVENTS);

// GET /in/:city/:cat/:event — one page per valid combination.
export function mountSeo(app) {
  app.get("/robots.txt", (c) =>
    new Response(
      `User-agent: *\nAllow: /\n\nSitemap: ${c.env.APP_ORIGIN}/sitemap.xml\n`,
      { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } }
    )
  );

  app.get("/sitemap.xml", async (c) => {
    const origin = String(c.env.APP_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, "");
    const today = new Date().toISOString().slice(0, 10);
    // Every public surface, not just the booking profile: gig requests and the
    // venue/occasion forms are the lead-capture pages organic search lands on.
    const urls = [
      "/", "/discover", "/collab", "/shows", "/jams", "/need", "/venues",
      "/match", "/invite", "/list-your-act", "/in",
    ];
    for (const city of CITIES)
      for (const cat of CATEGORIES_LIST)
        for (const ev of EVENTS_LIST)
          urls.push(`/in/${city.toLowerCase()}/${cat}/${ev}`);
    const [slugs, talent] = await Promise.all([
      c.env.DB.prepare("SELECT slug FROM artist_profiles ORDER BY slug")
        .all()
        .then((r) => r.results.map((a) => `/artist/${a.slug}`))
        .catch(() => []),
      c.env.DB.prepare(
        "SELECT slug FROM talent_directory WHERE status IN ('active','stale') ORDER BY slug"
      )
        .all()
        .then((r) => r.results.map((t) => `/talent/${t.slug}`))
        .catch(() => []),
    ]);
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      [...urls, ...slugs, ...talent]
        .map((u) => `  <url><loc>${origin}${u}</loc><lastmod>${today}</lastmod></url>`)
        .join("\n") +
      `\n</urlset>\n`;
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  });

  // Human hub — the spokes' parent for crawl paths and users alike.
  app.get("/in", async (c) => {
    const sections = CITIES.map((city) => {
      const rows = CATEGORIES_LIST.map((cat) => {
        const links = EVENTS_LIST.map(
          (ev) =>
            `<a href="/in/${city.toLowerCase()}/${cat}/${ev}">${CATEGORIES[cat].label} for ${EVENTS[ev].label} in ${city}</a>`
        ).join("");
        return `<div class="card"><h2>${CATEGORIES[cat].icon} ${CATEGORIES[cat].plural} in ${city}</h2><div class="links">${links}</div></div>`;
      }).join("");
      return `<h2 style="font-size:1.6rem;margin-top:26px">${city}</h2>${rows}`;
    }).join("");
    const html = page({
      title: "Artist hiring guides by city & event — Mehfil",
      desc: "Every Mehfil city guide: DJs, singers, live bands and anchors for birthdays, sangeets, weddings, kitty parties and corporate events in Pune, Mumbai and Jaipur — with real prices.",
      canonical: `${c.env.APP_ORIGIN}/in`,
      origin: c.env.APP_ORIGIN,
      body: {
        h1: "Hire artists by city, category and event",
        sub: "One guide per category × city × event type, with live prices and current availability straight from the marketplace.",
        pills: ["96 guides", "Live prices", "Escrow-protected"],
        ctaHref: "/discover",
        ctaLabel: "Browse all artists",
        sections,
        jsonld: null,
      },
    });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  });

  app.get("/in/:citySlug/:catSlug/:eventSlug", async (c) => {
    const { citySlug, catSlug, eventSlug } = c.req.param();
    const city = CITIES.find((s) => s.toLowerCase() === citySlug);
    const cat = CATEGORIES[catSlug];
    const ev = EVENTS[eventSlug];
    if (!city || !cat || !ev) {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const db = c.env.DB;
    const origin = c.env.APP_ORIGIN;
    const canonical = `${origin}/in/${citySlug}/${catSlug}/${eventSlug}`;
    const h1 = `${cat.label} for ${ev.label} in ${city}`;

    // Live marketplace data for this exact combo.
    const [artists, prices] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM artist_profiles WHERE city = ? AND category = ? ORDER BY rating DESC, reviews_count DESC LIMIT 8"
        )
        .bind(city, catSlug)
        .all(),
      db
        .prepare(
          `SELECT COUNT(*) AS n, MIN(p.price_inr) AS lo, MAX(p.price_inr) AS hi, AVG(p.price_inr) AS avg
           FROM packages p JOIN artist_profiles a ON a.id = p.artist_id
           WHERE a.city = ? AND a.category = ? AND p.active = 1`
        )
        .bind(city, catSlug)
        .first(),
    ]);
    const list = artists.results;
    const n = Number(prices?.n || 0);
    const lo = Number(prices?.lo || 0);
    const hi = Number(prices?.hi || 0);
    const avg = Math.round(Number(prices?.avg || 0) / 500) * 500;

    const title = `${cat.label} for ${ev.title} in ${city} — Verified Artists & Prices | Mehfil`;
    const desc = n
      ? `Book a verified ${cat.label.toLowerCase()} for your ${ev.label} in ${city}. ${list.length}+ artists, fixed-price packages from ${inr(lo)}, escrow-protected payment and real date availability.`
      : `Hiring a ${cat.label.toLowerCase()} for your ${ev.label} in ${city}? Compare verified artists, fixed-price packages and escrow-protected booking on Mehfil.`;

    const discoverHref = `/discover?category=${catSlug}&city=${encodeURIComponent(city)}`;
    const otherCats = CATEGORIES_LIST.filter((k) => k !== catSlug).map(
      (k) => `<a href="/in/${citySlug}/${k}/${eventSlug}">${CATEGORIES[k].label} for ${ev.label} in ${city}</a>`
    );
    const otherEvents = EVENTS_LIST.filter((k) => k !== eventSlug).map(
      (k) => `<a href="/in/${citySlug}/${catSlug}/${k}">${cat.label} for ${EVENTS[k].label} in ${city}</a>`
    );

    const priceSection = n
      ? `<div class="card">
  <h2>What does a ${esc(cat.label.toLowerCase())} cost for a ${esc(ev.label)} in ${esc(city)}?</h2>
  <div class="stats">
    <div class="stat"><b>${inr(lo)}</b><span>starting package</span></div>
    <div class="stat"><b>${inr(avg)}</b><span>typical booking</span></div>
    <div class="stat"><b>${inr(hi)}</b><span>premium package</span></div>
    <div class="stat"><b>${n}</b><span>fixed-price packages</span></div>
  </div>
  <p style="color:var(--text2);font-size:15px;margin:10px 0 0">Every number above is the full package price as listed by the artist — the 5% host fee is shown separately at checkout, and there is no quote-and-wait: what you see books now. Prices cover ${esc(city)}; travel beyond the artist's radius is quoted in the package.</p>
</div>`
      : `<div class="card empty">
  <h2>Pricing lands here as ${esc(cat.plural.toLowerCase())} join ${esc(city)}</h2>
  <p>No ${esc(cat.plural.toLowerCase())} have listed in ${esc(city)} yet. First movers set the market — <a href="/join" style="text-decoration:underline">claim the ${esc(cat.label.toLowerCase())} profile</a> for ${esc(city)}, or <a href="${esc(discoverHref)}" style="text-decoration:underline">browse ${esc(cat.plural.toLowerCase())} in other cities</a>.</p>
</div>`;

    const artistSection = list.length
      ? `<div class="card">
  <h2>${esc(cat.plural)} available for ${esc(ev.label)}s in ${esc(city)}</h2>
  <div class="grid">
    ${list
      .map(
        (a) => `<a class="artist" href="/artist/${esc(a.slug)}">
      <span class="av" style="background:linear-gradient(135deg,hsl(${a.hue} 62% 46%),hsl(${(a.hue + 52) % 360} 72% 56%))">${esc(String(a.stage_name).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
      <span><span class="nm">${esc(a.stage_name)}</span><span class="mt">${a.verified ? "✓ Verified · " : ""}${Number(a.rating).toFixed(1)}★ (${a.reviews_count} reviews) · ${a.gigs_done} gigs</span></span>
      <span class="pr">${inr(a.base_price_inr)}<small>onwards</small></span>
    </a>`
      )
      .join("\n    ")}
  </div>
  <p style="margin:14px 0 0"><a class="btn" href="${esc(discoverHref)}">See all ${esc(cat.plural.toLowerCase())} in ${esc(city)}</a></p>
</div>`
      : "";

    const faqs = [
      [
        `How much does a ${cat.label.toLowerCase()} cost for a ${ev.label} in ${city}?`,
        n
          ? `Fixed-price packages start at ${inr(lo)}, with most bookings around ${inr(avg)} and premium packages up to ${inr(hi)}. The price you see is the package price — a 5% host fee is itemised at checkout.`
          : `${cat.plural} haven't listed in ${city} yet, so no local price data exists. Set your budget on the discovery page — you'll see live prices the moment artists join.`,
      ],
      [
        `How does escrow protect a ${ev.label} booking in ${city}?`,
        `You pay a 40% advance that Mehfil holds — the artist is paid only after you confirm the show. The artist checks in at the venue through the app, the contract is generated from your booking, and cancellations refund per the artist's stated policy, shown before you pay.`,
      ],
      [
        `How far ahead should I book a ${cat.label.toLowerCase()} for a ${ev.label}?`,
        `Wedding-season dates (October–February) and weekend club nights book out 3–6 weeks ahead. Weekday kitty parties, birthdays and house parties often come together inside a week — check real availability by date on the discovery page.`,
      ],
      [
        `Can I hear ${cat.label.toLowerCase()} samples before booking?`,
        `Yes — every profile carries performance samples, verified gig history and two-way reviews from completed bookings only, so the reputation can't be faked or taken off-platform.`,
      ],
    ];

    const jsonld = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "ItemList",
          name: h1,
          itemListElement: list.map((a, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: { "@type": "Person", name: a.stage_name, url: `${origin}/artist/${a.slug}` },
          })),
        },
        {
          "@type": "FAQPage",
          mainEntity: faqs.map(([q, a]) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        },
      ],
    };

    const sections = `
<div class="crumbs"><a href="/in">All city guides</a> → ${esc(city)} → ${esc(cat.plural)} → ${esc(ev.title)}</div>
${priceSection}
${artistSection}
<div class="card">
  <h2>Booking a ${esc(cat.label.toLowerCase())} for a ${esc(ev.label)} in ${esc(city)}: how it works</h2>
  <ol class="steps">
    <li><b>Pick a fixed package</b> — duration, inclusions and price are listed upfront; no waiting on quotes.</li>
    <li><b>Send the brief and pay the advance</b> — date, venue, sound, power and must-play songs go to the artist; 40% is held in escrow and the contract is generated automatically.</li>
    <li><b>Event day, then release</b> — the artist checks in at the venue, you confirm the show, escrow releases, and both sides leave reviews that count toward verified reputation.</li>
  </ol>
</div>
<div class="card">
  <h2>Local tips for ${esc(ev.label)} bookings</h2>
  <ul class="tips">${ev.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
</div>
<div class="card">
  <h2>FAQ — ${esc(cat.label)} for ${esc(ev.label)} in ${esc(city)}</h2>
  ${faqs.map(([q, a]) => `<div class="faq"><b>${esc(q)}</b><p>${esc(a)}</p></div>`).join("\n  ")}
</div>
<div class="card">
  <h2>Keep browsing</h2>
  <div class="links">
    ${otherCats.join("\n    ")}
    ${otherEvents.join("\n    ")}
    <a href="/in">All city guides</a>
  </div>
</div>`;

    const html = page({
      title,
      desc,
      canonical,
      origin,
      body: {
        h1,
        sub: n
          ? `${list.length} verified ${list.length === 1 ? cat.label.toLowerCase() : cat.plural.toLowerCase()} in ${city} with packages from ${inr(lo)} — escrow-protected, contract-backed, booked in under five minutes.`
          : `Verified ${cat.plural.toLowerCase()} for ${ev.label}s in ${city} — fixed prices, escrow protection and real date availability, the moment they join.`,
        pills: [
          `${cat.icon} ${cat.label}`,
          `📍 ${city}`,
          `🎂 ${ev.title}`,
          n ? `From ${inr(lo)}` : "Profile open",
        ],
        ctaHref: discoverHref,
        ctaLabel: `See ${cat.plural} in ${city}`,
        sections,
        jsonld,
      },
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  });
}
