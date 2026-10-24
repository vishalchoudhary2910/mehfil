// Wikipedia discovery source for the Talent Radar.
//
// Why this exists: MusicBrainz is a music catalogue, so it has almost no
// poets, shayars, stand-up comics or anchors. Wikipedia does — with real
// biographies, real photographs and a citable source for every profile.
//
// We only read the public MediaWiki API (no scraping of private data), store
// a short intro extract, and always link back to the article. Wikipedia text
// is CC BY-SA; the profile page carries the attribution link, and the
// operator can remove any row from the Engines console.
//
// Queries look like:  incategory:"Indian poets" Pune
// which CirrusSearch resolves against the article's own categories and text,
// so every match is a real person whose article is connected to that city.

import { inferCategoryFromTags, inferCity, categoryLabel, normalizeCategory } from "../shared/categories.js";

const API = "https://en.wikipedia.org/w/api.php";
const UA = "MehfilTalentRadar/1.0 ( https://mehfil.app )";

// Canonical category → Wikipedia categories worth searching, best first.
// Empty lists are honest: we do not guess a category for a source that has
// no reliable category for it.
export const WIKI_CATEGORIES = {
  poet: ["Indian poets", "Marathi-language poets", "Hindi-language poets", "Urdu-language poets"],
  comedian: ["Indian stand-up comedians", "Indian comedians"],
  singer: ["Indian singers", "Indian playback singers"],
  band: ["Indian musical groups", "Indian rock music groups"],
  dancer: ["Indian dancers", "Indian choreographers"],
  anchor: ["Indian television presenters", "Indian television hosts"],
  magician: ["Indian magicians"],
  dj: ["Indian DJs"],
  instrumentalist: ["Indian instrumentalists"],
  storyteller: ["Indian storytellers"],
  rapper: ["Indian rappers"],
  dhol: [],
  other: [],
};

export const WIKI_CATEGORY_KEYS = Object.keys(WIKI_CATEGORIES).filter(
  (k) => WIKI_CATEGORIES[k].length
);

// City-specific Wikipedia categories are far more precise than a free-text
// city mention: membership guarantees where the person is from. They are
// sparse, so the generic search above is still the fallback.
export const WIKI_CITY_CATEGORIES = {
  poet: ["Poets from {city}"],
  comedian: ["Comedians from {city}"],
  singer: ["Singers from {city}", "Musicians from {city}"],
  band: ["Musical groups from {city}"],
  rapper: ["Rappers from {city}"],
  dancer: ["Dancers from {city}"],
  anchor: ["Television presenters from {city}"],
  dj: ["DJs from {city}"],
  magician: [],
  instrumentalist: [],
  storyteller: [],
  dhol: [],
  other: [],
};

const CITY_ALIASES = {
  bengaluru: ["Bangalore", "Bengaluru"],
  mumbai: ["Mumbai", "Bombay"],
  delhi: ["Delhi", "New Delhi"],
  "new delhi": ["New Delhi", "Delhi"],
};

const cityCategoryNames = (template, city) => {
  const key = String(city || "").toLowerCase().trim();
  const names = CITY_ALIASES[key] || [city];
  return names.filter(Boolean).map((c) => template.replace("{city}", c));
};

// A generic category page can contain people who merely touched that art
// form. Require the article's own short description or intro to name it, so a
// film director does not become a "stand-up comedian" in the directory.
export const CATEGORY_TEXT = {
  poet: /\b(poet|poetry|shayar|shayari|lyricist|kavi|nazm|mushaira)\b/i,
  comedian: /\b(comedian|comedy|stand[- ]?up|satir|mimicry|humou?r)\b/i,
  singer: /\b(singer|vocalist|playback|musician|composer|vocal)\b/i,
  band: /\b(band|group|ensemble|duo|trio|orchestra|collective)\b/i,
  rapper: /\b(rapper|rap|hip[- ]?hop)\b/i,
  dancer: /\b(dancer|dance|choreograph)\b/i,
  anchor: /\b(anchor|presenter|host|emcee|compere|television)\b/i,
  magician: /\b(magician|magic|illusion|mentalist)\b/i,
  dj: /\b(dj|disc jockey|electronic|producer)\b/i,
  instrumentalist: /\b(instrumentalist|guitarist|violinist|pianist|sitar|tabla|flautist|saxophon|percussion)\b/i,
  storyteller: /\b(storyteller|storytelling|theatre|theater|dastangoi|narrator)\b/i,
};

export function categoryMatchesText(category, page) {
  const re = CATEGORY_TEXT[category];
  if (!re) return true;
  const extract = String(page?.extract || "").trim();
  // Use the short description plus the first sentence only. Later sentences
  // often mention poetry in passing and would file a scholar as a poet.
  const sentence = extract.match(/^[^.!?]*[.!?]/)?.[0] || extract;
  const text = `${page?.description || ""}. ${sentence.slice(0, 320)}`;
  return re.test(text);
}

const LANGUAGE_HINTS = [
  [/marathi/i, "Marathi"],
  [/hindi/i, "Hindi"],
  [/urdu/i, "Urdu"],
  [/punjabi/i, "Punjabi"],
  [/tamil/i, "Tamil"],
  [/telugu/i, "Telugu"],
  [/bengali/i, "Bengali"],
  [/gujarati/i, "Gujarati"],
  [/kannada/i, "Kannada"],
  [/malayalam/i, "Malayalam"],
];

const GENRE_WORDS = [
  "sufi", "ghazal", "qawwali", "bollywood", "playback", "indie", "folk",
  "rock", "metal", "hip hop", "rap", "classical", "jazz", "electronic",
  "edm", "punjabi", "marathi", "urdu", "hindi", "bhajan", "devotional",
  "stand-up", "improv", "spoken word", "shayari", "theatre", "kathak",
  "bharatanatyam", "salsa", "contemporary",
];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const DEATH_YEARS = /\b(?:1[89]|20)\d{2}\s*[–—−-]\s*(?:1[89]|20)\d{2}\b/;
const DEATH_WORDS = /\b(died|death|posthumous|memorial|obituary)\b/i;

// A hiring directory must not list people who have passed away. Wikipedia
// descriptions usually say so inline — "(1964–2019)" — and a death word in
// the intro is the second signal.
export function looksLiving(page) {
  const desc = String(page?.description || "");
  const extract = String(page?.extract || "");
  if (DEATH_YEARS.test(desc) || DEATH_YEARS.test(extract)) return false;
  if (DEATH_WORDS.test(desc) || DEATH_WORDS.test(extract)) return false;
  if (/\bwas an?\b/i.test(extract.slice(0, 240)) && /\b(born|is)\b/i.test(desc) === false) {
    // "was an Indian poet" strongly implies a historical figure; "was born"
    // is present in living biographies and is checked separately.
    if (!/\bwas born\b/i.test(extract.slice(0, 240))) return false;
  }
  return true;
}

export function isListPage(page) {
  const title = String(page?.title || "");
  return /^(list of|lists of|index of|outline of)\b/i.test(title) || page?.pageid == null;
}

export function wikiSearchQuery(category, city) {
  const cats = WIKI_CATEGORIES[category] || [];
  if (!cats.length || !city) return "";
  return `incategory:"${cats[0]}" ${city}`;
}

function wikiApiUrl(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function wikiGet(params, fetchImpl = fetch) {
  const res = await fetchImpl(wikiApiUrl(params), {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`Wikipedia ${json.error.code || json.error.info || "error"}`);
  return json;
}

const PROPS = "extracts|pageimages|description|info|extlinks";

function searchParams({ category, city, limit }) {
  const query = wikiSearchQuery(category, city);
  return {
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(Math.max(1, Math.min(Number(limit) || 8, 20))),
    gsrnamespace: "0",
    prop: PROPS,
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    pithumbsize: "320",
    inprop: "url",
    ellimit: "20",
  };
}

// Search one category/city pair, falling back to the next category when the
// first one has no members near that city. Returns real page objects.
export async function wikiSearchPeople({ category, city, limit = 8, fetchImpl = fetch } = {}) {
  const cats = WIKI_CATEGORIES[category] || [];
  if (!city) return { pages: [], matchedCategory: "", matched: false };
  let lastError = null;

  // 1) Exact city category ("Comedians from Mumbai") — best city signal.
  for (const template of WIKI_CITY_CATEGORIES[category] || []) {
    for (const catName of cityCategoryNames(template, city)) {
      try {
        const json = await wikiGet(
          {
            action: "query",
            generator: "categorymembers",
            gcmtitle: `Category:${catName}`,
            gcmtype: "page",
            gcmlimit: String(Math.max(1, Math.min(Number(limit) || 8, 20))),
            prop: PROPS,
            exintro: "1",
            explaintext: "1",
            exsentences: "3",
            pithumbsize: "320",
            inprop: "url",
            ellimit: "20",
          },
          fetchImpl
        );
        const pages = (json?.query?.pages || []).filter((p) => p && !isListPage(p));
        if (pages.length) {
          return { pages, matchedCategory: catName, matched: true, query: catName, cityFromCategory: city };
        }
      } catch (e) {
        lastError = e;
        break;
      }
    }
  }

  // 2) Generic category + city text ("incategory:"Indian poets" Pune").
  if (!cats.length) return { pages: [], matchedCategory: "", matched: false };
  for (const cat of cats.slice(0, 2)) {
    const query = `incategory:"${cat}" ${city}`;
    try {
      const json = await wikiGet({ ...searchParams({ category, city, limit }), gsrsearch: query }, fetchImpl);
      const pages = (json?.query?.pages || []).filter((p) => p && !isListPage(p));
      if (pages.length) return { pages, matchedCategory: cat, matched: true, query };
    } catch (e) {
      lastError = e;
      break;
    }
  }
  if (lastError) throw lastError;
  return { pages: [], matchedCategory: "", matched: false };
}

// Re-read specific articles in one batch (up to 20) so existing profiles get
// fresh copy, images and links without one request per artist.
export async function wikiRefreshPages(titles, { fetchImpl = fetch } = {}) {
  const list = [...new Set((titles || []).filter(Boolean))].slice(0, 20);
  if (!list.length) return [];
  const json = await wikiGet(
    {
      action: "query",
      titles: list.join("|"),
      prop: PROPS,
      exintro: "1",
      explaintext: "1",
      exsentences: "3",
      pithumbsize: "320",
      inprop: "url",
      ellimit: "20",
      redirects: "1",
    },
    fetchImpl
  );
  return (json?.query?.pages || []).filter((p) => p && !p.missing && !isListPage(p));
}

function linksFromExtlinks(extlinks = []) {
  const urls = extlinks.map((e) => (typeof e === "string" ? e : e?.["*"] || e?.url)).filter(Boolean);
  const links = {};
  for (const url of urls) {
    const u = String(url);
    if (/instagram\.com/i.test(u) && !links.instagram) links.instagram = u;
    else if (/(youtube\.com|youtu\.be)/i.test(u) && !links.youtube) links.youtube = u;
    else if (/spotify\.com/i.test(u) && !links.spotify) links.spotify = u;
    else if (/soundcloud\.com/i.test(u) && !links.soundcloud) links.soundcloud = u;
    else if (/facebook\.com/i.test(u) && !links.facebook) links.facebook = u;
  }
  const news = /(wikipedia\.org|wikidata\.org|timesofindia|thehindu|mid-day|hindustantimes|indianexpress|bbc\.|reuters|forbes|imdb\.)/i;
  const site = urls.find((u) => /^https?:\/\//i.test(u) && !news.test(u) && !/instagram|youtube|spotify|soundcloud|facebook/i.test(u));
  if (site) links.website = site;
  return links;
}

function languagesFor(matchedCategory, text) {
  const out = new Set();
  for (const [re, lang] of LANGUAGE_HINTS) {
    if (re.test(matchedCategory || "")) out.add(lang);
  }
  if (!out.size) {
    for (const [re, lang] of LANGUAGE_HINTS) if (re.test(text)) out.add(lang);
  }
  return [...out].slice(0, 4);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word matching matters here: "rap" inside "choreography" used to tag a
// kathak dancer as a rapper. Short genre words must not match inside longer
// words.
const GENRE_RES = GENRE_WORDS.map((g) => [
  g,
  new RegExp(`(^|[^a-z0-9])${escapeRe(g)}([^a-z0-9]|$)`, "i"),
]);

function genresFor(text) {
  const t = String(text || "").toLowerCase();
  return [...new Set(GENRE_RES.filter(([, re]) => re.test(t)).map(([g]) => g))].slice(0, 6);
}

const firstSentences = (text, max = 340) => {
  const s = clean(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.trim()) + (stop > 80 ? "" : "…");
};

// Map a Wikipedia page into a directory entry. The city comes from the
// article intro, never from the search term: a Delhi poet whose article
// happens to mention Pune must not be filed under Pune.
export function mapWikiPage(page, { city = "", cityFromCategory = "", category = "", matchedCategory = "" } = {}) {
  if (!page || isListPage(page) || !looksLiving(page)) return null;
  const name = clean(page.title);
  if (!name || name.length > 120) return null;
  const desc = clean(page.description);
  const extract = clean(page.extract);
  const text = `${desc}. ${extract}`;
  const cat = normalizeCategory(category) === "other" && matchedCategory
    ? inferCategoryFromTags([matchedCategory], name)
    : normalizeCategory(category);
  if (!categoryMatchesText(cat, page)) return null;
  const inferred = cityFromCategory || inferCity(text, "");
  const links = linksFromExtlinks(page.extlinks || []);
  const url = page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`;
  // The article itself is the public source listing for an unclaimed profile.
  if (!links.url) links.url = url;
  const bio = firstSentences(extract || desc || `${categoryLabel(cat)} listed on Wikipedia.`);
  return {
    name,
    category: cat,
    city: inferred || "",
    area: "",
    genres: genresFor(text),
    languages: languagesFor(matchedCategory, text),
    bio,
    links,
    image_url: clean(page.thumbnail?.source || "").replace(/\?utm_source=.*$/i, ""),
    followers: 0,
    source: "wikipedia",
    source_url: url,
    external_id: page.pageid ? `wiki:${page.pageid}` : null,
    verification: "listed",
    open_to_work: 0,
  };
}
