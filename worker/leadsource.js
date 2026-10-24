// Lead sourcing + normalization — pure functions, node-testable with no I/O.
// Used by worker/leads.js for the CSV import and Google Places sync paths.

// --- CSV ---------------------------------------------------------------------
// Minimal RFC-4180-ish parser: handles quoted fields, embedded commas/newlines
// and escaped double-quotes. Returns an array of {header: value} objects.
export function parseCsv(text) {
  const s = String(text || "");
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows
    .filter((r) => r.some((x) => String(x).trim()))
    .map((r) => {
      const o = {};
      header.forEach((h, idx) => { o[h] = String(r[idx] ?? "").trim(); });
      return o;
    });
}

// Flexible header matching so a client's sheet needn't use our exact columns.
const pick = (row, keys) => {
  for (const k of keys) if (row[k]) return row[k];
  // fallback: substring match on any header
  for (const hk of Object.keys(row)) {
    if (keys.some((k) => hk.includes(k)) && row[hk]) return row[hk];
  }
  return "";
};

// --- normalization -----------------------------------------------------------
export function normalizePhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return d.slice(2);
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return d.slice(1);
  return d;
}

export function normalizeUrl(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

export function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

// Stable dedupe key for a lead: strongest identifier first (phone, then
// website host, then email, then name+city). Case/space-insensitive.
export function dedupeKey(lead) {
  const phone = normalizePhone(lead.phone);
  if (phone) return "ph:" + phone;
  if (lead.website) {
    try { return "wb:" + new URL(normalizeUrl(lead.website)).host.replace(/^www\./, ""); } catch { /* fall through */ }
  }
  if (lead.email) return "em:" + normalizeEmail(lead.email);
  const nk = String(lead.name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (nk) return "nm:" + nk + "|" + String(lead.city || "").toLowerCase().trim();
  return "";
}

const KIND_WORDS = /cafe|coffee|restro|restaurant|bar|pub|club|lounge|banquet|hotel|venue|hall|resort|bistro|tapri/i;
export function inferKind(category, name) {
  const s = `${category} ${name}`;
  if (/dj|singer|band|anchor|emcee|guitar|sax|live act|artist|perform/i.test(s)) return "artist";
  if (KIND_WORDS.test(s)) return "venue";
  return "client";
}

// Map a CSV row (already header-lowered by parseCsv) to a lead object.
export function rowToLead(row, source = "csv") {
  const name = pick(row, ["name", "venue", "business", "company", "artist", "establishment", "place"]);
  const lead = {
    name,
    category: pick(row, ["category", "type", "segment", "genre"]).toLowerCase(),
    city: pick(row, ["city", "location", "town"]),
    area: pick(row, ["area", "locality", "neighborhood", "neighbourhood", "district", "zone"]),
    address: pick(row, ["address", "full_address", "street"]),
    phone: normalizePhone(pick(row, ["phone", "mobile", "contact", "number", "whatsapp"])),
    website: normalizeUrl(pick(row, ["website", "url", "site", "web"])),
    instagram: pick(row, ["instagram", "ig", "insta", "handle"]),
    email: normalizeEmail(pick(row, ["email", "mail", "e-mail"])),
    source,
  };
  lead.kind = inferKind(lead.category, lead.name);
  return lead;
}

// --- Google Places (New) API --------------------------------------------------
const PLACE_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber",
  "places.websiteUri", "places.rating", "places.userRatingCount",
  "places.addressComponents",
].join(",");

// Text Search (New). `fetchImpl` is injectable for tests. Returns parsed JSON.
export async function placesSearch({ text, key, fetchImpl = fetch, pageSize = 20, pageToken }) {
  const body = { textQuery: text, maxResultCount: Math.min(pageSize, 20), languageCode: "en", regionCode: "IN" };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": PLACE_FIELDS + ",nextPageToken",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Places ${res.status}: ${t.slice(0, 180)}`);
  }
  return res.json();
}

const compText = (c) => c.longText || c.shortText || "";
export function mapPlace(place, city, category) {
  const comps = place.addressComponents || [];
  const area = comps
    .filter((c) => (c.types || []).some((t) => t === "sublocality_level_1" || t === "sublocality" || t === "neighborhood"))
    .map(compText)
    .join(", ");
  return {
    kind: "venue",
    name: place.displayName?.text || place.name || "",
    category: category || "venue",
    city: city || "",
    area: area || "",
    address: place.formattedAddress || "",
    phone: normalizePhone(place.nationalPhoneNumber || place.internationalPhoneNumber || ""),
    website: normalizeUrl(place.websiteUri || ""),
    instagram: "",
    email: "",
    rating: typeof place.rating === "number" ? place.rating : null,
    reviews_count: place.userRatingCount || 0,
    external_id: place.id || null,
    source: "places",
  };
}

// --- matchmaking --------------------------------------------------------------
// How well a client/venue lead fits a Mehfil artist. City + category affinity
// dominate; verified and high-rated leads are prioritised. Pure + testable.
import { categoriesForVenue, distanceKm, cityCoords } from "../shared/categories.js";

export function matchScore(lead, artist) {
  let score = 0;
  const reasons = [];
  if (lead.city && artist.city && lead.city.toLowerCase() === artist.city.toLowerCase()) {
    score += 40; reasons.push("same city");
  } else if (lead.city && artist.city) {
    const km = distanceKm(cityCoords(lead.city), cityCoords(artist.city));
    if (km == null || km > Math.max(80, Number(artist.travel_radius_km) || 0)) {
      return { score: 0, reasons: ["different city"] };
    }
    score += 18; reasons.push(`${km} km away`);
  }
  const genres = categoriesForVenue(lead.category);
  const cat = (artist.category || "").toLowerCase();
  if (genres.includes(cat)) { score += 25; reasons.push(`${cat} fits ${lead.category}`); }
  if (lead.area && artist.area && lead.area.toLowerCase() === artist.area.toLowerCase()) {
    score += 8; reasons.push("same neighbourhood");
  }
  if (Number(lead.wants_artists)) { score += 15; reasons.push("open to artists"); }
  if (lead.verification === "verified") { score += 15; reasons.push("verified lead"); }
  if (lead.rating) score += Math.min(5, Math.round(lead.rating));
  return { score, reasons };
}

// --- resilience ---------------------------------------------------------------
// Retry a fallible async op with linear backoff (Places 429/5xx, transient
// network). Non-retryable errors (e.g. 403 bad key) throw immediately.
export async function withRetry(fn, { retries = 2, baseMs = 350 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      lastErr = e;
      const msg = String(e && e.message ? e.message : e);
      const retryable = /\b429\b|\b50\d\b|timeout|fetch failed|ECONN|socket/i.test(msg);
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, baseMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Follow nextPageToken to pull up to maxPages pages (60 results) for one query,
// pausing between pages as Places requires. Returns { places }.
export async function placesSearchAll({ text, key, fetchImpl = fetch, maxPages = 3 }) {
  const all = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    const data = await withRetry(() => placesSearch({ text, key, fetchImpl, pageToken }));
    all.push(...(data.places || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 200)); // Places wants a beat before the next page
  }
  return { places: all };
}
