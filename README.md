# Mehfil — Artist Hiring, Collaboration & Jam Circles

*“Hire, team up, and perform — the operating system for live and creative talent.”*

A production-shaped MVP of the two-sided marketplace from **Artist_Hiring_Platform_Plan.pdf**:
the marketing **website** plus the **app** (discovery → fixed-price packages → instant booking
with an event brief → escrow-protected advance → auto-generated contract → event-day check-in →
payout release → two-way reviews), along with the plan's differentiator — the **collaborator
board** — plus public shows, a daily **talent radar**, a **lead engine**, a **gig-request**
engine ("I need an artist today"), and **Jam Circles** (free, casual hangouts and live
“need an audience” broadcasts).

## What's in the box

| Surface | What it does |
|---|---|
| **Website** (`src/pages/Landing.jsx`) | SEO-shaped landing with live hero stats, category grid, featured artists, jam/show teasers |
| **Discovery** (`/discover`) | Search + filter bookable profiles *and* the daily-discovered directory in one feed; poets/shayars first-class |
| **Booking** (`/book/:packageId`) | Instant-book a package; advance into simulated escrow; auto-generated contract; state machine with cancel/refund matrix |
| **Collab board** (`/collab`) | The wedge — musicians post/apply for gigs, sessions, band slots |
| **Shows** (`/shows`) | Real event feeds (iCal/RSS/Bandsintown/Eventbrite) + user-published shows; RSVP |
| **Jam Circles** (`/jams`, `/jam/:token`) | Free casual jams and live broadcasts — host, share, RSVP, go live; engine sweep retires stale rows |
| **Gig requests** (`/need`) | “I need an artist today” — ranked matches, tokenized invites, availability/quotes, nudges, expiry, alerts |
| **Lead engine** (`/leads`) | Owner console for venue/client demand — Places/CSV/claim sources, verification, outreach, matchmaking |
| **Engine room** (`/engines`) | Owner console: run/monitor all five engines, manage feeds, add acts by hand or CSV |
| **Share previews** (`worker/share.js`) | Every `/artist/:slug` and `/talent/:slug` link is served with that act's title, description, price and Person JSON-LD — real WhatsApp/X cards, plus one-tap share buttons on profiles |
| **Invite loop** (`/invite`) | Referral link, WhatsApp/X/copy sharing, two verified invites unlock the Founding Artist badge |

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React SPA (`src/`) | One codebase, SEO-shaped routes |
| Backend | Hono API in a Cloudflare Worker (`worker/index.js`) | Edge API, one deployable unit |
| Database | Cloudflare D1 (SQLite) | Relational integrity for bookings/escrow; local Miniflare state |
| Auth | Sign in with Freebuff (`@freebuff/auth`) | No secrets, wraps the Worker once; `getUser` on every user route |
| Hosted on | Freebuff Sites (site id in `freebuff-site.json`) | Preview + production environments |

---

## Quick start (clone → running in 5 minutes)

```bash
# 1. Clone and install
git clone https://github.com/<you>/<repo>.git
cd <repo>
npm install

# 2. Seed the local database with demo data
npm run seed:local

# 3. Start the API + built SPA on :8787
npm run start          # = npm run build && wrangler dev
```

Open **http://127.0.0.1:8787** — you'll see the landing page, discovery, shows, jams and the
public claim page with no configuration at all.

> **No `.dev.vars`? No problem.** The Worker boots without `FREEBUFF_CLIENT_ID`: every public
> route serves normally, and the auth-gated APIs answer an honest `401` instead of crashing.
> Sign-in only starts working once you add the auth variables below — until then the app is a
> fully browsable public site. (A regression test, `tests/boot.test.mjs`, pins this behaviour.)

The **auth-gated** pages (booking, artist desk, leads, engine room) require a Freebuff session —
see [Auth setup](#auth-setup-local--production).

> **Windows note:** run `vite build` *before* starting (or after stopping) `wrangler dev`.
> Rebuilding `dist` while its asset watcher is live can trip an `EBUSY` watcher error and
> serve 404s for `index.html` until the worker restarts.

### Development mode (hot reload)

```bash
# Terminal 1 — API on :8787 (this machine's local dev DB lives in C:/mehfil-state)
npx wrangler dev --persist-to C:/mehfil-state --port 8787

# Terminal 2 — Vite dev server on :5173 (proxies /api → :8787)
npm run dev
```

**Windows note:** this workspace path is long; the default local D1 path can exceed `MAX_PATH`
(260) and make workerd fail with a generic `internal error`. Always pass `--persist-to` a short
path (like `C:/mehfil-state`) to `wrangler dev` and `wrangler d1 execute --local`. The
project's `seed:local` script already passes it.

---

## Engine room — the five engines

All engines run on Cloudflare Cron Triggers (configured in `wrangler.jsonc`) and are
**manually runnable** from the owner console (`/engines`) or the CLI
(`npm run engines:local`).

| Engine | Cron | What it does | Source of truth |
|---|---|---|---|
| **Talent radar** | daily 03:00 | Finds real artists from Wikipedia, MusicBrainz, YouTube, event listings; refreshes existing rows, retires stale ones | `worker/talent.js`, `wikisource.js` |
| **Shows feed** | daily 03:00 | Re-reads iCal/RSS/Bandsintown/Eventbrite feeds; creates/updates/retires shows; every show also becomes a demand lead | `worker/showfeed.js` |
| **Lead engine** | daily 03:00 | Paginates Places, re-verifies stale leads (7-day TTL), queues cold outreach for one-to-one contact (consent-backed email only), matches open leads to artists, sends digest | `worker/leads.js`, `leadsource.js`, `verify.js` |
| **Lifecycle** | hourly + daily | Venue shortlist sequences (day 0/2/7), rebooking nudges, consent + suppression, unsubscribe and send caps | `worker/lifecycle.js` |
| **Gig requests** | daily + every 4 h | Nudges unanswered invitations, expires dead ones, fires alerts (artists/shows/leads/jams) | `worker/requests.js` |
| **Jam sweep** | every cron tick | Retires jams whose day is over (or 4 h past start), purges rows older than 30 days | `worker/jam.js` |

Each engine fails independently: one bad feed never stops the others. Every run is recorded in
`*_runs` tables and surfaced in the engine room's “Recent engine runs”.

### Outreach safety

- Cold venue outreach is **queued**, never emailed. Email is sent only when an address has an
  explicit consent row for that purpose.
- Every marketing email carries `List-Unsubscribe` + a one-click link; a suppression always wins
  and stops all active sequences for that address.
- Sends are gated to 09:00–19:00 IST and capped at 40/day, independently of the provider quota.
- The unsubscribe page lives at `/unsubscribe` and is served by the Worker, not the SPA.

### Run engines locally against the dev database

```bash
# Run all engines against the persisted local D1
npm run engines:local -- --db C:/tmp/mf/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite

# Run a single scope
npm run engines:local -- --db … --scope talent
npm run engines:local -- --db … --scope jams
```

---

## Jam Circles — how it works

Jam Circles are **free by design** — no booking, no escrow, no commission. They sit beside the
paid flows (bookings, gig requests) and serve the casual scene: acoustic circles, open decks,
shayari nights, or “I'm performing right now and need bodies”.

1. **Host** a jam (`POST /api/jams`): title, city, date, instruments, vibe, capacity.
   A shareable link (`/jam/:token`) is copied automatically.
2. **Attendees** RSVP (`POST /api/jams/:token/rsvp`) — one tap, no account needed beyond sign-in.
   Capacity flips the jam to `full`; leaving reopens it.
3. **Broadcast live** (`POST /api/jams/:token/broadcast`): only the host, only on the day,
   throttled to once per 30 minutes. Sends a Telegram ping and emails every attendee
   (via Resend) so the call reaches beyond the open tab.
4. **Alerts**: anyone can subscribe to jams in a city (`/api/alerts` with `kind: "jams"`).
   The alert engine delivers new sessions and live broadcasts by email.
5. **Sweep**: the jam engine retires jams from previous days (or 4 h past the posted start) and
   purges rows older than 30 days, so the tables stay small without manual cleanup.

Key routes: `GET/POST /api/jams`, `GET /api/jams/:token`, `POST /api/jams/:token/{rsvp,broadcast,cancel}`.

---

## Auth setup (local + production)

Sign in with Freebuff needs **no secrets** — only a public client ID registered per environment.

### Local development

1. In Freebuff Desktop, run **`sites_enable_auth`** for this site with the local Worker origin
   (e.g. `http://127.0.0.1:8787`). It returns public **development** variables.
2. Put them in `.dev.vars` (already git-ignored):

   ```
   FREEBUFF_CLIENT_ID=<dev client id>
   FREEBUFF_ISSUER=<dev issuer>
   APP_ORIGIN=http://127.0.0.1:8787
   ```

3. Restart `wrangler dev`. The Worker enables `allowInsecureLocalhost` automatically when
   `APP_ORIGIN` is a loopback address — never enable it in production.

### Production

Deployed `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` are **injected automatically**
by Freebuff Sites at deploy time. Do not copy dev values into production. The production
callback URL must match the deployed origin exactly.

---

## Environment variables (all optional)

The app runs with **zero** configuration. Each variable unlocks a capability; the engine room
shows which are set.

| Variable | Unlocks | Set where |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Venue lead sync from Places | Sites → Secrets / `.dev.vars` |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Telegram alerts + digests | Sites → Secrets / `.dev.vars` |
| `RESEND_API_KEY` + `RESEND_FROM` | Real outreach/invite/alert email | Sites → Secrets / `.dev.vars` |
| `YOUTUBE_API_KEY` | YouTube channel discovery in the radar | Sites → Secrets / `.dev.vars` |
| `BANDSINTOWN_APP_ID` | Bandsintown show feed | Sites → Secrets / `.dev.vars` |
| `EVENTBRITE_TOKEN` | Eventbrite show feed | Sites → Secrets / `.dev.vars` |
| `LEAD_OWNER_EMAILS` | Comma-separated owner emails for the Leads/Engine consoles (production; loopback dev is always open) | Sites → Secrets / `.dev.vars` |

Wikipedia, MusicBrainz, iCal/RSS feeds, the whole request/claim loop and Jam Circles work with
**none** of these.

---

## Project layout

```
src/                        React SPA
  App.jsx                   routes + nav/footer + RequireAuth gate
  session.jsx               api() fetch wrapper (same-origin cookies) + SessionProvider
  ui.jsx                    Avatar/Stars/StatusPill/Badges/INR helpers
  pages/
    Landing.jsx             marketing landing with live teasers
    Discover.jsx            search + filter (profiles + directory)
    ArtistProfile.jsx       public profile + packages + reviews
    BookFlow.jsx            booking wizard → escrow
    Bookings.jsx            host bookings list
    BookingDetail.jsx       booking timeline + contract
    Dashboard.jsx           artist desk (bookings, availability, payouts)
    Collab.jsx              collaborator board
    Shows.jsx               real event feeds + RSVP
    Jams.jsx                Jam Circles feed + host/join/broadcast
    JamDetail.jsx           public jam share page
    Join.jsx                artist onboarding
    Leads.jsx               owner lead console
    Claim.jsx               public /list-your-act self-registration
    Need.jsx                gig request form + live status
    Respond.jsx             tokenized performer response
    Engines.jsx             owner engine room

worker/                     Hono API (Cloudflare Worker)
  index.js                  main fetch handler, auth-wrapped; SEO routes; booking/collab/shows API
  talent.js                 talent radar (directory upsert, claim, self-registration)
  wikisource.js             Wikipedia source for the radar
  showfeed.js               iCal/RSS/Bandsintown/Eventbrite show ingestion
  leads.js                  lead engine (Places/CSV/claim, verify, outreach, match)
  leadsource.js             Places + matching helpers
  verify.js                 phone/email-MX/Instagram verification
  requests.js               gig-request engine (fanOut, followups, alerts)
  jam.js                    Jam Circles (create/RSVP/broadcast/sweep)
  engines.js                orchestrator (runDaily/runFrequent, status, digest)
  mail.js                   Resend email adapters
  notify.js                 Telegram + notify_log
  util.js                   shared helpers (resolveUser, isWorkspaceOwner, shapeArtist)
  seo.js                    server-rendered /in/:city/:category pages, sitemap
  extra.js                  teams, payouts, follows, match, packages API
  search.js                 unified search endpoint
  billing.js                payout/escrow helpers

shared/
  categories.js             single taxonomy (worker + SPA import the same file)

scripts/
  run-engines.mjs           run engines locally against a persisted D1 file
  local-db.mjs              node:sqlite D1 shim for the runner

tests/                      node:test suites (52 tests)
  talent.test.mjs           radar upsert/dedupe/claim/Wikipedia mapping
  showfeed.test.mjs         iCal/RSS parsing, price inference, upsert idempotency
  leads.test.mjs            CSV/Places mapping, verification, dedupe, matching
  requests.test.mjs         fanOut, followups, expiry, alerts, back-and-forth messaging
  jam.test.mjs              jam create/RSVP/broadcast/cancel/sweep/alerts
  categories.test.mjs       taxonomy normalization, venue→talent, city distance
  search.test.mjs           search endpoint behaviour

schema.sql                  full D1 schema (all tables)
seed.sql                    demo marketplace data
wrangler.jsonc              Worker config (D1 binding, crons, assets)
```

---

## Database

The full schema lives in **`schema.sql`** — every table the app creates idempotently
(`CREATE TABLE IF NOT EXISTS`) is also declared there for a clean install. Each engine module
additionally runs a once-per-isolate `ensure*Schema` so a fresh database self-migrates on the
first request; `schema.sql` is the canonical reference and the seed source.

Key tables: `users`, `artist_profiles`, `packages`, `bookings`, `booking_events`, `reviews`,
`collab_posts`, `shows`, `rsvps`, `talent_directory`, `leads`, `lead_events`, `booking_requests`,
`request_targets`, `request_events`, `request_messages`, `alerts`, `jam_sessions`, `jam_rsvps`,
`engine_runs`, `*_runs` (per-engine ledgers).

---

## Performance & reliability

- **Route-level code splitting.** Only the homepage ships in the entry chunk; discovery,
  profiles, the match deck, booking and the operator consoles load on demand
  (`initial JS ≈ 204 kB raw / 68 kB gzip`, 22 chunks). A route that fails to load shows a
  retry panel instead of a blank page.
- **Motion is compositor-only.** Count-ups write to `textContent` (no React re-renders),
  the scroll progress bar and header condense are rAF-throttled, pointers tilt only on
  hover-capable devices, and every observer/frame/listener is cleaned up on unmount.
  Landing sections use CSS scroll-driven animation where supported — no scroll handlers.
- **Bounded storage.** The service worker (v2) caches only the app shell and same-origin
  hashed assets/images (max 120 entries); `/api` and `/auth` are never cached, per-profile
  SSR HTML never replaces the offline shell, and the worker is skipped in Vite dev.
- **Safe defaults.** `prefers-reduced-motion` disables every ambient animation, forms keep
  16 px inputs to stop iOS zoom, and the mobile tab bar respects `safe-area-inset`.

## Testing

```bash
npm test                   # all suites (node:test, 52 tests)
node --test tests/jam.test.mjs   # one suite
```

Tests run the **real engine code** against an in-memory `node:sqlite` D1 shim
(`tests/helpers.mjs`) — no network, no Worker. External HTTP (Wikipedia, MusicBrainz, iCal/RSS,
Telegram, Resend) is mocked per test.

Coverage highlights:
- Radar dedupe (same act from two sources → one row), claimed profiles survive refresh,
  Wikipedia genre mapping never invents a career.
- Show iCal/RSS parsing, free/paid price inference, host-written shows never clobbered by feeds.
- Gig-request fanOut dedupe, follow-up clock (same-day compression), expiry before doors,
  back-and-forth messaging without accounts, alert idempotency.
- Jam capacity/`full`/re-open, broadcast throttling, day-only broadcast, sweep expiry + purge,
  jam alert idempotency.

---

## Deploying (Freebuff Sites)

1. Build: `npm run build` → `dist/` (SPA assets) + the Worker bundle.
2. `sites_deploy` preview with the JSON manifest (`entrypoint index.js`,
   `assetsDirectory ./dist`, `spa: true`). Provision D1/R2 first via `sites_add_storage`.
3. Auth is already provisioned for this site (`freebuff-site.json`); deployed
   `FREEBUFF_CLIENT_ID`/`FREEBUFF_ISSUER`/`APP_ORIGIN` are injected automatically.
4. Set optional secrets (Telegram, Resend, Places, YouTube…) in **Sites → Secrets**.
5. Seed the hosted D1, then verify sign-in on the real origin before publishing.

Production publishing needs explicit authorization; preview URLs are also public.

---

## Verification done

- `vite build` clean; `wrangler deploy --dry-run` clean.
- **70 unit tests** green across eight suites.
- API matrix via curl: filters, combined filters, JSON 404s, hostile inputs (SQLi-shaped params),
  CSRF foreign origin → 403, every user route signed-out → 401, auth routes reachable.
- Browser walkthrough (signed out, 390px and 1440px): landing, discovery + filters, artist profile,
  talent profile, venues, gig request, invite, collab, shows; no horizontal overflow and console
  clean apart from the expected `/api/me` 401 probe.
- UI pass at both widths: condensed sticky header with scroll progress, mobile tab bar, animated
  hero stats, pointer-tilt stage card, two-up category tiles, snap artist rail, one-row discover
  filters, booking-card identity strip, share sheet — with all listeners and observers cleaned up.
- **Lead capture end-to-end**: a venue brief submitted in the browser wrote `venue_interest`, recorded
  `venue_shortlist` consent and queued an active sequence; a public gig brief created the request and
  invited two matched performers. Test rows were removed afterwards.
- **Share reach**: `/artist/:slug` and `/talent/:slug` return the SPA shell with per-act `<title>`,
  description, canonical, `og:*`/`twitter:*` and Person JSON-LD; `/sitemap.xml` lists 189 URLs
  (guides, artists, directory acts, venue/need/match pages) and `/robots.txt` points at it.
- **Engines** verified end-to-end via a `node:sqlite` D1 shim: radar create/refresh/retire,
  show feed create/update, lead verify → verified/invalid, request follow-up nudge/expire,
  jam sweep expiry/purge, alert idempotency — all against the real engine functions.
- **Blocked:** sign-in and the fully authenticated flow (book → accept → check-in → complete →
  review → onboarding → jams broadcast) needs a real Freebuff session in the browser.

---

## License

Private. All rights reserved.
