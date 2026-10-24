// Shared talent taxonomy, city geography and venue→talent affinity.
// Imported by the worker (matching/radar) and by the React app (pickers),
// so the site never disagrees with the engine about what a "poet" is.

export const CATEGORIES = {
  dj: {
    label: "DJ",
    icon: "🎧",
    aliases: ["dj", "disc jockey", "turntablist", "deejay"],
    skills: ["Bollywood", "Deep House", "Commercial", "Sufi Chill", "Retro", "EDM", "Garba", "Afro House"],
  },
  singer: {
    label: "Singer",
    icon: "🎤",
    aliases: ["singer", "vocalist", "playback singer", "ghazal singer", "sufi singer", "qawwal", "singer-songwriter", "vocal"],
    skills: ["Bollywood", "Semi-Classical", "Ghazal", "Sufi", "Bhajan", "Indie", "Acoustic", "Folk"],
  },
  band: {
    label: "Live Band",
    icon: "🎸",
    aliases: ["band", "live band", "music group", "ensemble", "collective", "qawwali group", "orchestra", "rock band", "fusion band"],
    skills: ["Punjabi Live", "Sufi", "Fusion", "Folk", "Indie", "Open Mic", "Funk", "Rock", "Qawwali"],
  },
  anchor: {
    label: "Anchor / Emcee",
    icon: "🎙️",
    // "mc" alone is left out on purpose: it is a common stage-name prefix
    // ("MC Stan"), so matching it would file rappers as anchors.
    aliases: ["anchor", "emcee", "host", "compere", "presenter"],
    skills: ["Sangeet", "Corporate", "Kitty Party", "College Fest", "Bilingual", "Games & Host"],
  },
  poet: {
    label: "Poet / Shayar",
    icon: "🪶",
    aliases: ["poet", "shayar", "shayari", "poetry", "urdu poetry", "hindi poetry", "kavi", "kavita", "spoken word", "open mic poet", "mushaira"],
    skills: ["Urdu Shayari", "Hindi Kavita", "Mushaira", "Sufi Poetry", "Spoken Word", "Story Poetry", "Nazm", "Ghazal Recital"],
  },
  comedian: {
    label: "Comedian",
    icon: "🎭",
    aliases: ["comedian", "comedy", "stand-up", "standup", "stand up", "comic", "improv", "sketch"],
    skills: ["Stand-up", "Improv", "Crowd Work", "Corporate", "Hindi", "English", "Roast", "Clean Set"],
  },
  rapper: {
    label: "Rapper / Hip-hop",
    icon: "🔥",
    // "hip hop" stays out of the aliases on purpose: "instrumental hip hop"
    // is a DJ/beat act, and the tag pass below resolves that case first.
    aliases: ["rapper", "rap artist", "rap", "desi hip hop", "battle rap", "freestyle rap", "hip hop artist", "hiphop artist"],
    skills: ["Desi Hip-hop", "Freestyle", "Battle Rap", "Boom Bap", "Trap", "Hindi Rap", "Marathi Rap", "Conscious"],
  },
  dancer: {
    label: "Dancer / Troupe",
    icon: "💃",
    aliases: ["dancer", "dance", "choreographer", "kathak", "bharatanatyam", "salsa", "belly dance", "hip hop dancer", "garba troupe"],
    skills: ["Bollywood", "Kathak", "Salsa", "Hip Hop", "Garba", "Contemporary", "Bharatanatyam", "Sangeet Choreo"],
  },
  instrumentalist: {
    label: "Instrumentalist",
    icon: "🎻",
    aliases: ["instrumentalist", "guitarist", "violinist", "saxophonist", "pianist", "flautist", "sitarist", "sarangi", "tabla player", "percussionist", "keyboardist"],
    skills: ["Guitar", "Violin", "Saxophone", "Piano", "Flute", "Sitar", "Sarangi", "Tabla"],
  },
  dhol: {
    label: "Dhol / Percussion",
    icon: "🥁",
    aliases: ["dhol", "dholak", "nagada", "drummer", "percussion", "tasha", "dhol player"],
    skills: ["Dhol", "Dholak", "Nagada", "Tasha", "Wedding Procession", "Sangeet Entry"],
  },
  magician: {
    label: "Magician",
    icon: "🎩",
    aliases: ["magician", "magic", "illusionist", "mentalist", "close-up magic"],
    skills: ["Close-up", "Stage Magic", "Mentalism", "Kids Party", "Corporate"],
  },
  storyteller: {
    label: "Storyteller",
    icon: "📖",
    aliases: ["storyteller", "storytelling", "dastangoi", "narrator", "puppet", "theatre", "theater"],
    skills: ["Dastangoi", "Folk Tales", "Kids", "Theatre", "Oral History"],
  },
  other: {
    label: "Other act",
    icon: "✨",
    aliases: [],
    skills: ["Photography", "Videography", "Makeup", "Live Painting", "Fire Act", "Caricature"],
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const PUBLIC_CATEGORY_KEYS = CATEGORY_KEYS.filter((k) => k !== "other");
export const categoryLabel = (k) => CATEGORIES[k]?.label || "Performer";
export const categoryIcon = (k) => CATEGORIES[k]?.icon || "✨";

const norm = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Priority order matters: "sufi poet" is a poet, "sufi singer" a singer.
const ORDER = ["poet", "comedian", "storyteller", "magician", "dancer", "dhol", "instrumentalist", "rapper", "anchor", "band", "singer", "dj"];

const ALIAS_RE = (() => {
  const out = {};
  for (const key of ORDER) {
    out[key] = CATEGORIES[key].aliases.map(
      (a) => new RegExp(`(^|[^a-z0-9])${escapeRe(a)}([^a-z0-9]|$)`, "i")
    );
  }
  return out;
})();

// Map any messy source text ("Sufi singer-songwriter from Pune", "shayar",
// "standup comic") to one canonical category. Never returns null.
export function normalizeCategory(raw, name = "") {
  if (raw && CATEGORIES[raw]) return raw;
  const text = norm(`${raw} ${name}`);
  if (!text) return "other";
  for (const key of ORDER) {
    if (ALIAS_RE[key].some((re) => re.test(text))) return key;
  }
  return "other";
}

// Source-tag → category. Tags come from catalogues (MusicBrainz and friends)
// where "bollywood", "filmi" or "lo-fi" really describe the act. Kept apart
// from the aliases above so a venue called "Bollywood Nights" is never
// reclassified as a singer.
const TAG_HINTS = [
  ["poet", /\b(poetry|poet|shayari|shayar|mushaira|nazm|kavita|spoken word|ghazal poetry|urdu literature|hindi literature)\b/i],
  ["comedian", /\b(comedy|comedian|stand[- ]?up|improv|satire|humou?r)\b/i],
  ["rapper", /\b(rapper|rap|hip[- ]?hop|beatmaker|desi hip hop)\b/i],
  ["storyteller", /\b(storytelling|storyteller|dastangoi|theatre|theater|puppetry|narrative)\b/i],
  ["magician", /\b(magic|magician|illusion|mentalism)\b/i],
  ["dancer", /\b(dance|dancer|kathak|bharatanatyam|odissi|kuchipudi|salsa|ballet|garba|choreograph)\b/i],
  ["dhol", /\b(dhol|dholak|nagada|tasha)\b/i],
  ["band", /\b(band|rock|metal|orchestra|ensemble|choir|trio|quartet)\b/i],
  ["singer", /\b(singer|vocal|vocalist|playback|filmi|bollywood|ghazal|sufi|qawwali|bhajan|devotional|indian pop|kirtan|folk music)\b/i],
  ["dj", /\b(dj|edm|techno|house music|deep house|downtempo|ambient|lo-?fi|chillwave|electronic|beats|beatmaker|drum and bass|trance)\b/i],
  ["instrumentalist", /\b(instrumental|guitarist|guitar|violin|piano|sitar|sarangi|tabla|flute|bansuri|saxophone|cello|harmonium)\b/i],
];

export function inferCategoryFromTags(tags = [], name = "", type = "") {
  const list = (tags || []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
  const text = list.join(" ");
  // "hip hop" in a music catalogue usually means a rapper, but an
  // "instrumental hip hop" act is a producer/DJ set. Resolve that before the
  // generic alias pass so both land in the right bucket.
  if (/\binstrumental\b/i.test(text) && /\bhip[- ]?hop\b/i.test(text)) return "dj";
  if (/\b(rapper|rap)\b/i.test(text) || (/\bhip[- ]?hop\b/i.test(text) && !/instrumental/i.test(text))) {
    return "rapper";
  }
  const direct = normalizeCategory(text, name);
  if (direct !== "other") return direct;
  for (const [key, re] of TAG_HINTS) if (re.test(text)) return key;
  if (/group|orchestra|choir|band/i.test(type)) return "band";
  if (/^(the\s+)?[A-Z]/.test(name) && /collective|band|trio|quartet/i.test(name)) return "band";
  return "other";
}

// ---------------------------------------------------------------- geography --
// City centroids: good enough for "near me" ranking between cities, exact
// coordinates take over when a source (Places) supplies them.
export const CITY_COORDS = {
  pune: [18.5204, 73.8567],
  mumbai: [19.076, 72.8777],
  bombay: [19.076, 72.8777],
  thane: [19.2183, 72.9781],
  navi_mumbai: [19.033, 73.0297],
  jaipur: [26.9124, 75.7873],
  delhi: [28.6139, 77.209],
  "new delhi": [28.6139, 77.209],
  gurugram: [28.4595, 77.0266],
  noida: [28.5355, 77.391],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  ahmedabad: [23.0225, 72.5714],
  surat: [21.1702, 72.8311],
  lucknow: [26.8467, 80.9462],
  chandigarh: [30.7333, 76.7794],
  indore: [22.7196, 75.8577],
  nagpur: [21.1458, 79.0882],
  nashik: [19.9975, 73.7898],
  goa: [15.4909, 73.8278],
  panaji: [15.4909, 73.8278],
  udaipur: [24.5854, 73.7125],
  jodhpur: [26.2389, 73.0243],
  kochi: [9.9312, 76.2673],
  coimbatore: [11.0168, 76.9558],
  bhopal: [23.2599, 77.4126],
  patna: [25.5941, 85.1376],
  vadodara: [22.3072, 73.1812],
  visakhapatnam: [17.6868, 83.2185],
  dehradun: [30.3165, 78.0322],
  guwahati: [26.1445, 91.7362],
  ranchi: [23.3441, 85.3096],
  raipur: [21.2514, 81.6296],
  thiruvananthapuram: [8.5241, 76.9366],
  mysuru: [12.2958, 76.6394],
  amritsar: [31.634, 74.8723],
  ludhiana: [30.901, 75.8573],
  varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081],
  meerut: [28.9845, 77.7064],
  rajkot: [22.3039, 70.8022],
  bhubaneswar: [20.2961, 85.8245],
};

export const KNOWN_CITIES = Object.keys(CITY_COORDS)
  .filter((c) => !c.includes("_") && !["bombay", "bangalore", "new delhi", "panaji"].includes(c))
  .map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase()));

export function cityCoords(city) {
  const k = norm(city);
  if (!k) return null;
  if (CITY_COORDS[k]) return CITY_COORDS[k];
  const first = k.split(",")[0].trim();
  if (CITY_COORDS[first]) return CITY_COORDS[first];
  return null;
}

export function distanceKm(a, b) {
  if (!a || !b) return null;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

// A show/venue listing dropped at a city name: which known city is it?
export function inferCity(text, fallback = "") {
  const t = norm(text);
  if (!t) return fallback;
  for (const key of Object.keys(CITY_COORDS)) {
    if (new RegExp(`(^|[^a-z])${escapeRe(key.replace(/_/g, " "))}([^a-z]|$)`, "i").test(t)) {
      return key.replace(/\b\w/g, (m) => m.toUpperCase());
    }
  }
  return fallback;
}

// ------------------------------------------------------- demand ↔ talent ------
// Which talent categories a venue/client category should be matched with.
// Keys are matched as substrings of the lead's category, so "poetry cafe"
// catches both poet and cafe-type demand.
export const VENUE_GENRES = {
  "poetry club": ["poet", "storyteller", "singer"],
  "poetry cafe": ["poet", "storyteller", "singer"],
  mushaira: ["poet", "storyteller"],
  "comedy club": ["comedian", "anchor"],
  "open mic": ["comedian", "poet", "singer", "rapper", "band"],
  cafe: ["singer", "band", "poet", "comedian", "instrumentalist"],
  coffee: ["singer", "band", "poet", "comedian"],
  club: ["dj", "singer", "rapper", "anchor", "band"],
  nightclub: ["dj", "singer", "rapper", "band"],
  lounge: ["dj", "singer", "instrumentalist", "poet"],
  bar: ["dj", "singer", "band", "comedian"],
  pub: ["dj", "singer", "band", "comedian"],
  restaurant: ["singer", "band", "instrumentalist", "anchor"],
  banquet: ["band", "anchor", "singer", "dancer", "dhol", "magician"],
  hotel: ["band", "anchor", "singer", "dancer", "magician"],
  resort: ["band", "dj", "singer", "dancer", "magician"],
  wedding: ["band", "anchor", "dhol", "dancer", "singer", "magician", "poet"],
  sangeet: ["dancer", "anchor", "dhol", "band", "singer"],
  corporate: ["anchor", "comedian", "band", "magician", "singer"],
  college: ["dj", "band", "comedian", "poet", "rapper", "anchor", "dancer"],
  festival: ["band", "dj", "singer", "poet", "comedian", "rapper", "dancer", "storyteller"],
  "house party": ["dj", "singer", "rapper", "instrumentalist"],
  "kitty party": ["anchor", "magician", "singer", "comedian"],
  theatre: ["storyteller", "dancer", "comedian", "magician"],
};

// Resolve a lead's free-text category to candidate talent categories.
export function categoriesForVenue(leadCategory) {
  const c = norm(leadCategory);
  if (!c) return [];
  // A lead that is itself a talent category ("poet", "dhol") maps 1:1.
  if (CATEGORIES[c]) return [c];
  for (const [k, v] of Object.entries(VENUE_GENRES)) {
    if (c.includes(k)) return v;
  }
  return [];
}
