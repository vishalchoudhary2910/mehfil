-- Mehfil marketplace schema (D1 / SQLite)
-- Core entities per the product plan: User, ArtistProfile, Package, Booking,
-- EscrowEvent, Review, CollabPost, Show, Rsvp.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  auth_sub    TEXT UNIQUE NOT NULL,      -- Freebuff auth subject (sub)
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,                      -- masked to the other party until paid
  city        TEXT,
  kind        TEXT NOT NULL DEFAULT 'host', -- 'host' | 'artist' (an account can be both; artist_profiles decides)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artist_profiles (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             TEXT UNIQUE NOT NULL,
  stage_name       TEXT NOT NULL,
  category         TEXT NOT NULL,        -- 'dj' | 'singer' | 'band' | 'anchor' | 'other'
  sub_skills       TEXT NOT NULL DEFAULT '[]',  -- JSON array
  city             TEXT NOT NULL,
  languages        TEXT NOT NULL DEFAULT '[]',  -- JSON array
  bio              TEXT NOT NULL DEFAULT '',
  experience_years INTEGER NOT NULL DEFAULT 1,
  travel_radius_km INTEGER NOT NULL DEFAULT 25,
  base_price_inr   INTEGER NOT NULL DEFAULT 0,  -- cheapest package, denormalised for filters
  rating           REAL NOT NULL DEFAULT 0,
  reviews_count    INTEGER NOT NULL DEFAULT 0,
  gigs_done        INTEGER NOT NULL DEFAULT 0,
  response_mins    INTEGER NOT NULL DEFAULT 60,
  verified         INTEGER NOT NULL DEFAULT 0,
  founding_artist  INTEGER NOT NULL DEFAULT 0,
  cancellation_policy TEXT NOT NULL DEFAULT 'moderate', -- flexible | moderate | strict
  hue              INTEGER NOT NULL DEFAULT 265,        -- avatar gradient hue
  instagram        TEXT,
  youtube          TEXT,
  area             TEXT NOT NULL DEFAULT '',           -- locality, for "near me" matching
  available_now    INTEGER NOT NULL DEFAULT 1,          -- shown on the emergency board
  accepting_requests INTEGER NOT NULL DEFAULT 1,        -- opt out without hiding the profile
  directory_id     TEXT,                                -- talent_directory row this was claimed from
  portfolio_url    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_artists_city ON artist_profiles(city);
CREATE INDEX IF NOT EXISTS idx_artists_category ON artist_profiles(category);

CREATE TABLE IF NOT EXISTS packages (
  id              TEXT PRIMARY KEY,
  artist_id       TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_inr       INTEGER NOT NULL,
  duration_hours  REAL NOT NULL DEFAULT 3,
  inclusions      TEXT NOT NULL DEFAULT '[]', -- JSON array
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_packages_artist ON packages(artist_id);

-- Dates an artist is already booked on (derived from confirmed bookings,
-- maintained as a table so discovery can filter by date cheaply).
CREATE TABLE IF NOT EXISTS artist_booked_dates (
  artist_id  TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  -- Holds both real bookings ("b_…") and confirmed gig requests ("req:…"),
  -- so this column intentionally has no foreign key.
  booking_id TEXT NOT NULL,
  PRIMARY KEY (artist_id, date, booking_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  host_id       TEXT NOT NULL REFERENCES users(id),
  artist_id     TEXT NOT NULL REFERENCES artist_profiles(id),
  package_id    TEXT REFERENCES packages(id),
  package_name  TEXT NOT NULL,          -- snapshot at booking time
  amount_inr    INTEGER NOT NULL,
  advance_inr   INTEGER NOT NULL,       -- portion held in escrow up front
  fee_inr       INTEGER NOT NULL,       -- platform commission (5% host + 6% artist, simplified)
  event_type    TEXT NOT NULL,
  event_date    TEXT NOT NULL,          -- YYYY-MM-DD
  start_time    TEXT NOT NULL DEFAULT '20:00',
  venue         TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL,
  guest_count   INTEGER NOT NULL DEFAULT 100,
  brief         TEXT NOT NULL DEFAULT '{}', -- JSON: sound, power, songs, dress, notes
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | completed | cancelled | disputed
  escrow        TEXT NOT NULL DEFAULT 'none',    -- none | held | released | refunded | frozen
  policy        TEXT NOT NULL DEFAULT 'moderate',
  host_reviewed INTEGER NOT NULL DEFAULT 0,
  artist_reviewed INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_id);
CREATE INDEX IF NOT EXISTS idx_bookings_artist ON bookings(artist_id);

-- Append-only timeline: quotes, accepts, escrow movements, check-ins, reviews.
CREATE TABLE IF NOT EXISTS booking_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- booked | escrow_held | confirmed | checked_in | completed | escrow_released | cancelled | refunded | disputed | review_left
  actor_id   TEXT REFERENCES users(id),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_booking ON booking_events(booking_id);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  artist_id   TEXT NOT NULL REFERENCES artist_profiles(id),
  for_host    INTEGER NOT NULL DEFAULT 1,  -- 1 = host reviewing artist, 0 = artist reviewing host
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id, reviewer_id, for_host)
);

CREATE INDEX IF NOT EXISTS idx_reviews_artist ON reviews(artist_id);

-- "Find a collaborator" board — the differentiation wedge.
CREATE TABLE IF NOT EXISTS collab_posts (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id   TEXT REFERENCES artist_profiles(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,            -- "Need a tabla player for Saturday gig"
  role_needed TEXT NOT NULL,
  city        TEXT NOT NULL,
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  pay_inr     INTEGER NOT NULL DEFAULT 0,
  details     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open', -- open | filled | closed
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collab_applications (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES collab_posts(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'applied', -- applied | accepted | declined
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (post_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS shows (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  performers  TEXT NOT NULL DEFAULT '',
  venue       TEXT NOT NULL,
  city        TEXT NOT NULL,
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  start_time  TEXT NOT NULL DEFAULT '20:00',
  is_free     INTEGER NOT NULL DEFAULT 1,
  price_inr   INTEGER NOT NULL DEFAULT 0,
  capacity    INTEGER NOT NULL DEFAULT 100,
  description TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual',  -- manual | ical | rss | bandsintown | eventbrite
  source_url  TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  dedupe_key  TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL DEFAULT '',
  organizer   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',  -- active | past | archived
  last_seen_at TEXT,
  updated_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_dedupe ON shows(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_shows_status ON shows(status);
CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(date);

CREATE TABLE IF NOT EXISTS rsvps (
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (show_id, user_id)
);

-- ------------------------------------------------------------ phase 2 ----
-- Teams / bands (P1 create, P2 split payouts): one shared artist profile,
-- members with roles and default split percentages enforced to sum 100.
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  genre       TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  about       TEXT NOT NULL DEFAULT '',
  leader_id   TEXT NOT NULL REFERENCES users(id),
  profile_id  TEXT REFERENCES artist_profiles(id) ON DELETE SET NULL,
  hue         INTEGER NOT NULL DEFAULT 200,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- leader | manager | member
  split_pct  INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active',  -- active | left
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invitee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by  TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'member',
  split_pct   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (team_id, invitee_id)
);

-- Ledger of every rupee owed to artists: gig splits on escrow release and tips.
CREATE TABLE IF NOT EXISTS payouts (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'gig',   -- gig | tip
  gross_inr   INTEGER NOT NULL,
  fee_inr     INTEGER NOT NULL DEFAULT 0,
  net_inr     INTEGER NOT NULL,
  split_pct   INTEGER NOT NULL DEFAULT 100,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follows (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id  TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_payouts_booking ON payouts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_invitee ON team_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_follows_artist ON follows(artist_id);

-- ------------------------------------------------------------ lead engine --
-- Sourced from Google Places (venues), CSV imports and self-serve artist
-- claims. verification = is the contact real/reachable; status = pipeline
-- stage. dedupe_key is the strong identifier used to upsert on refresh.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'venue',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  dedupe_key TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'unverified',
  verify_detail TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  wants_artists INTEGER NOT NULL DEFAULT 1,
  rating REAL,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedupe ON leads(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_city_cat ON leads(city, category);
CREATE INDEX IF NOT EXISTS idx_leads_kind ON leads(kind);
CREATE INDEX IF NOT EXISTS idx_leads_verif ON leads(verification);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_checked ON leads(last_checked_at);

CREATE TABLE IF NOT EXISTS lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id);

CREATE TABLE IF NOT EXISTS lead_interests (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  artist_id TEXT,
  user_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lead_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_interests_lead ON lead_interests(lead_id);

CREATE TABLE IF NOT EXISTS notify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT, topic TEXT, payload TEXT,
  status TEXT NOT NULL DEFAULT 'sent', error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  places_fetched INTEGER DEFAULT 0, places_new INTEGER DEFAULT 0, places_updated INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0, invalid INTEGER DEFAULT 0, matches INTEGER DEFAULT 0, outreach INTEGER DEFAULT 0,
  notified INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);

CREATE TABLE IF NOT EXISTS lead_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);

-- ------------------------------------------------------------- talent radar --
-- Unclaimed performer profiles discovered from public/open sources. Claiming
-- one creates an artist_profiles row (quote-per-gig, no packages required).
CREATE TABLE IF NOT EXISTS talent_directory (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  genres TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '{}',
  image_url TEXT NOT NULL DEFAULT '',
  followers INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  dedupe_key TEXT NOT NULL DEFAULT '',
  match_key TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'unverified',
  open_to_work INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  claimed_by TEXT,
  claimed_artist_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_talent_dedupe ON talent_directory(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_talent_match ON talent_directory(match_key);
CREATE INDEX IF NOT EXISTS idx_talent_city ON talent_directory(city);
CREATE INDEX IF NOT EXISTS idx_talent_cat ON talent_directory(category);
CREATE INDEX IF NOT EXISTS idx_talent_status ON talent_directory(status);

CREATE TABLE IF NOT EXISTS talent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT NOT NULL DEFAULT 'cron',
  queries INTEGER DEFAULT 0, fetched INTEGER DEFAULT 0, created INTEGER DEFAULT 0, refreshed INTEGER DEFAULT 0,
  stale INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, removed INTEGER DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '{}', ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE TABLE IF NOT EXISTS talent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ----------------------------------------------------------- gig requests ---
CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, host_id TEXT,
  host_name TEXT NOT NULL DEFAULT '', host_email TEXT NOT NULL DEFAULT '', host_phone TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '20:00', duration_hours REAL NOT NULL DEFAULT 3,
  event_type TEXT NOT NULL DEFAULT '', guest_count INTEGER NOT NULL DEFAULT 50, budget_inr INTEGER NOT NULL DEFAULT 0,
  brief TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'soon', auto_invite INTEGER NOT NULL DEFAULT 1,
  radius_km INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open',
  matched INTEGER NOT NULL DEFAULT 0, invited INTEGER NOT NULL DEFAULT 0,
  filled_target_id TEXT, filled_artist_id TEXT, lead_id TEXT, ip TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_req_token ON booking_requests(token);
CREATE INDEX IF NOT EXISTS idx_req_status ON booking_requests(status);

CREATE TABLE IF NOT EXISTS request_targets (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL,
  artist_id TEXT, directory_id TEXT, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT 'link', status TEXT NOT NULL DEFAULT 'invited',
  quote_inr INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]', nudges INTEGER NOT NULL DEFAULT 0,
  invited_at TEXT NOT NULL DEFAULT (datetime('now')), last_nudge_at TEXT, responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_target_token ON request_targets(token);
CREATE INDEX IF NOT EXISTS idx_target_request ON request_targets(request_id);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_events ON request_events(request_id);

-- Per-performer thread on a gig request: the host and the performer can go
-- back and forth without an account, using their tokenised links.
CREATE TABLE IF NOT EXISTS request_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  target_id TEXT,
  role TEXT NOT NULL DEFAULT 'host',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_messages ON request_messages(request_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'artists', city TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
  max_price INTEGER NOT NULL DEFAULT 0, q TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT NOT NULL DEFAULT 'cron',
  requests INTEGER DEFAULT 0, nudged INTEGER DEFAULT 0, expired INTEGER DEFAULT 0,
  alerts INTEGER DEFAULT 0, fired INTEGER DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);

CREATE TABLE IF NOT EXISTS show_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT NOT NULL DEFAULT 'cron',
  feeds INTEGER DEFAULT 0, fetched INTEGER DEFAULT 0, created INTEGER DEFAULT 0, updated INTEGER DEFAULT 0,
  past INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, removed INTEGER DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE TABLE IF NOT EXISTS show_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT NOT NULL DEFAULT 'cron',
  scopes TEXT NOT NULL DEFAULT '[]', talent_created INTEGER DEFAULT 0, shows_created INTEGER DEFAULT 0,
  leads_new INTEGER DEFAULT 0, invites INTEGER DEFAULT 0, responses INTEGER DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);

-- Jam Circles: free, casual hangouts and live "need an audience" broadcasts.
CREATE TABLE IF NOT EXISTS jam_sessions (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  host_id TEXT,
  host_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'jam',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '19:00',
  instruments TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'open',
  broadcasts INTEGER NOT NULL DEFAULT 0,
  last_broadcast_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jam_status ON jam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_jam_date ON jam_sessions(date);
CREATE INDEX IF NOT EXISTS idx_jam_city ON jam_sessions(city);

CREATE TABLE IF NOT EXISTS jam_rsvps (
  jam_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (jam_id, user_id)
);

CREATE TABLE IF NOT EXISTS jam_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  expired INTEGER DEFAULT 0, purged INTEGER DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
