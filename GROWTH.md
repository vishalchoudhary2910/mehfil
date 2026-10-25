# Mehfil growth autopilot

**Market opportunities, compliant automation, and the build order**

_Written 25 Oct 2026. Grounded in the code in this repo, the five existing engines, and current
platform/provider rules. Sources are linked inline and listed at the end._

---

## The one-paragraph answer

Mehfil already has the hard part: a lead engine, a talent radar, a show feed, referral codes,
venue capture and a daily cron. What it does **not** have is the layer that turns those assets
into compounding growth: intent capture, lifecycle follow-up, partner/venue referral loops,
attribution, and a daily "what changed in the market" signal. The highest-ROI work is not more
scraping or more channels — it is (1) making the existing outreach **legal and deliverable**,
(2) converting the leads and interest already in the database, (3) going deep on the two
high-ticket segments (weddings and corporate) and the recurring-venue segment, and (4) adding a
small, human-approved intent inbox for Reddit/X/web signals. Fully automated cold DMs are not
permitted on any major platform; the realistic target is **80–90% hands-off**, with a one-tap
human gate on the first cold touch.

**If you only do five things:**

1. Stop cold-emailing Places leads through Resend; add consent, unsubscribe and suppression before
   scaling any outbound.
2. Turn `venue_interest` into a three-touch shortlist sequence (day 0 / 2 / 7) with real acts and
   prices — the demand is already captured, just unanswered.
3. Add rebooking and event-anniversary automation; repeat bookings are the cheapest revenue.
4. Launch planner/banquet referral codes with a tracked fee — weddings are the high-ticket segment.
5. Add one approved intent inbox and one weekly city roundup; both compound without spam risk.

---

## 1. What already exists (and what each piece is missing)

| Engine | Cadence | What it does today | The gap that costs growth |
|---|---|---|---|
| **Talent radar** (`worker/talent.js`) | Daily 03:00 | Finds artists from Wikipedia, MusicBrainz, YouTube, event listings; refreshes and retires rows | Discovered artists are never invited to claim the pre-built profile; no activation sequence |
| **Shows feed** (`worker/showfeed.js`) | Daily 03:00 | iCal/RSS/Bandsintown/Eventbrite → shows; every show becomes a demand lead | Show data is not turned into city roundups, social posts, or "book the act you saw" offers |
| **Lead engine** (`worker/leads.js`) | Daily 03:00 | Places + CSV sourcing, verification, matching, half-auto or full-auto outreach, digest | Auto-outreach cold-emails scraped addresses through Resend (policy violation); no unsubscribe, suppression, follow-up sequence, reply detection or attribution |
| **Gig requests** (`worker/requests.js`) | Daily + every 4 h | Invites, nudges, expiries, alerts | No urgency tier for "tomorrow" gigs; no WhatsApp path, which is where Indian gigs actually get filled |
| **Jam sweep** (`worker/jam.js`) | Every tick | Retires finished jams, purges old rows | Jams are a community funnel but attendees are never routed to "hire this act" |
| **Referral loop** (`worker/growth.js`, `/invite`) | On demand | Artist invite codes, Founding Artist badge at 2 listed invites | No host/planner/venue referral codes, no payout ledger, no leaderboard |
| **Venue capture** (`/venues`, `venue_interest`) | On demand | Café/bar/wedding demand form + confirmation email | One email then silence; no shortlist, nurture, or booking follow-up |
| **SEO engine** (`worker/seo.js`) | Server-rendered | 96 city × category × event pages, hub, sitemap | No weekly content, no internal links from fresh demand, no wedding/corporate event types |
| **Market pulse** | — | Only an engine-run digest | No supply/demand gap report, no price signal, no source ROI |

**Immediate red flag:** `contactLead` calls `sendOutreachEmail` for Google-Places leads. Resend's
Acceptable Use Policy explicitly prohibits cold outreach and scraped lists, and requires
unsubscribe handling. In full-auto mode the cron cold-emails up to five businesses a day with no
opt-out. That can get the sending domain terminated — and it is not a defensible growth base.
This is the first thing to fix, before adding any new channel.

---

## 2. The constraint most "automate everything" plans miss

Platform rules, not technology, set the ceiling. Current state (2026):

| Channel | Fully automatable | Not permitted / needs a human | Cost / limit that matters |
|---|---|---|---|
| **Resend email** | Transactional mail to users; opted-in nurture with unsubscribe | Cold outreach, purchased or scraped lists (AUP explicitly bans) | 3,000/mo, 100/day free; 10 req/s; account termination risk for cold sends |
| **WhatsApp Cloud API** | Opt-in confirmations, booking updates, approved marketing templates, replies inside the 24 h service window | Messaging without opt-in; free-form marketing outside a window | India list rates ≈ ₹0.86 marketing, ₹0.115 utility per delivered message; new portfolios capped at 250 unique recipients/24 h |
| **Instagram Graph** | Publishing, comment replies, one private reply to a commenter within 7 days, inbound messaging within 24 h | Cold DMs; messaging outside the window; automated prospecting comments | 750 private replies/hour; professional account + Meta app review for other businesses |
| **Reddit** | Listening/alerts; API posting only after access approval and per-community rules | Unsolicited DMs, keyword auto-replies, bulk promotion | ~100 queries/min per OAuth client for eligible free access; access is gated |
| **X** | Scheduled original posts, replies to inbound interactions, support | Cold DMs, bulk follows, keyword reply bots, unapproved AI replies | Pay-per-use: ~$0.015/post, ~$0.20/post with URL, ~$0.015/DM interaction |
| **LinkedIn** | Normal human posting; approved Marketing API use cases | Scraping, bots, bulk connection requests, automated messages | Account restriction is the enforcement |
| **SMS/voice (TRAI)** | Consent-based, DLT-registered templates and headers | Commercial calls/SMS without registration and consent | 140-series promotional, 1600-series service; DND preferences apply |
| **India DPDP** | Consent records, purpose limitation, withdrawal path | Repurposing contact data for unrelated marketing without a basis | Rules notified Nov 2025; main obligations phase in to May 2027 — build consent now |

**Implication:** the growth system should automate *intelligence, drafting, routing, scheduling,
and owned-channel sending*. The first cold touch on a social platform stays human or paid. That
is not a limitation to apologise for — it is also what keeps reply rates and brand quality high.

---

## 3. Market opportunities, ranked by revenue per unit of effort

India's live-event segment passed **₹12,000 crore in 2024 with ~19% projected annual growth**
(EY/BookMyShow, Apr 2025), and the organised segment grew **44% in 2025** (FICCI–EY, Mar 2026).
BookMyShow alone listed **34,086 live events in 2025** and **Jaipur live-event footfall grew 33%**.
The market is not the constraint; distribution and trust are.

### 3.1 Recurring venue nights — supply density, not margin

Café/small-act fees run **₹3,000–15,000**; club gigs **₹10,000–50,000** (Mochsha, Jan 2025;
StarClinch, Nov 2025). At Mehfil's ~11% take, a ₹8,000 café night earns ~₹880; a monthly repeat is
worth ~₹10,500/year. This segment is a **supply-density and content play**, not a paid-acquisition
play. Sell a **paid pilot with an agreed success measure** (covers, reservations, ticket sales),
never a free trial; then convert to a recurring monthly night. The lead engine already finds these
venues via Places — what is missing is the pilot offer, the follow-up, and the repeat contract.

### 3.2 Weddings and planners — the high-ticket engine

India's wedding-services market is estimated at **US$103.9 bn (2024, 14.3% CAGR)**; **84.4% of
revenue is local weddings** and **51% of couples rely heavily on word of mouth** (Grand View
Research). The 2025 season alone was projected at **46 lakh weddings / ₹6.5 lakh crore** (CAIT).
Published wedding fees: singer ₹15k–50k, DJ ₹20k–75k, band ₹40k–2L+ (BMT Agency, Jul 2025).
Book major acts **3–5 months ahead**; popular dates go 8–12 months out.

The buyer is often a **planner, banquet sales lead or decorator**, not the couple. Mehfil has no
partner referral product yet. Extend the existing referral table to planner/venue codes with a
tracked payout — this is the single highest-ticket acquisition loop available, and it is
relationship-driven rather than spam-driven.

### 3.3 Corporate and seasonal — calendar-driven, budget-rich

Corporate events run **₹20,000–1,00,000+** (Mochsha). Buyers are HR/office-admin teams planning
annual days, offsites and Diwali parties. This is a **calendar product**: publish "Diwali 2026
packages", "annual day", "offsite" pages, and run a September–October outbound wave to opted-in
corporate contacts. Low volume, high value, predictable seasonality.

### 3.4 Jaipur / tier-2 depth — where the growth is

Jaipur footfall grew **33%** in 2025 while large venues remain concentrated in metros. Tier-2
demand is real but fragmented; local venue relationships and language/format fit matter more than
a national catalogue. The 96 SEO pages already exist; the next step is **one city at a time** with
a local venue map, weekly "what's on" roundup, and 30–50 verified acts — not a wider, thinner
national list.

### 3.5 Community → bookings — the cheapest demand

Jam circles and open mics already exist in-product. Attendees are people who just watched live
performers and enjoyed it. A post-jam follow-up ("want this act at your place?") is near-zero
cost, high-intent and fully compliant, because the person attended an event on the platform.
Likewise, every completed booking should trigger a **rebook / anniversary** reminder — the
plan already names this, but no engine sends it.

### 3.6 Urgent and last-minute gigs

Venues lose nights to cancellations; artists want same-week work. The request engine already
tracks dates and sends invites, but there is no **urgency tier** and no WhatsApp/Telegram
broadcast to matched artists. This is a differentiated, high-frequency use case that builds habit
on both sides.

### 3.7 Trust as the moat

The research is consistent: hosts struggle to verify quality, compare unlike quotes, confirm what
is included, and handle cancellations. Mehfil already has verification, escrow, contracts and
masked contact. Growth content should sell **"verified availability and real prices"** against
Instagram/WhatsApp — not compete on reach.

### Unit economics check

At ~11% take (5% host + 6% artist), approximate net revenue per booking:

| Booking | Typical fee | Mehfil take | What it can fund |
|---|---:|---:|---|
| Café night | ₹8,000 | ~₹880 | Organic/referral only; paid ads rarely pay back |
| Club night | ₹25,000 | ~₹2,750 | Small retargeting; referral fee viable |
| Corporate | ₹60,000 | ~₹6,600 | Paid search, partner commission |
| Wedding | ₹80,000 | ~₹8,800 | Partner commission, planner events |

**So:** use cafés for supply, content and habit; make weddings, corporate and recurring venue
contracts carry acquisition cost. Do not buy ads against ₹8k café gigs.

---

## 4. The growth machine

Five layers, each with a clear owner and cadence:

```
LISTEN  →  CAPTURE  →  SCORE/ENRICH  →  ROUTE/ENGAGE  →  CONVERT  →  RETAIN  →  LEARN
Reddit/X   forms       city+category      queue + draft     booking     rebook     source ROI
Google     referrals   availability       approved sends    escrow      review     experiments
Alerts     shows       intent score       WhatsApp/email    contract    anniversary price data
```

### 4.1 What runs on a schedule (no human)

| Cadence | Job | Uses |
|---|---|---|
| Every 15 min | Inbound reply/booking-status check; urgent-gig matching for dates ≤72 h | D1, request engine |
| Hourly | Pull new intent signals (Google Alerts RSS, Reddit/X search if access granted); dedupe; score; queue drafts; send approved/opt-in follow-ups inside quiet hours | New `intent_signals`, `outreach_queue` |
| Daily 03:00 | Places sync, verification, matchmaking, lifecycle sequences, digest | Existing engines |
| Daily 09:00 IST | Owner digest: new signals, queued drafts, yesterday's conversions, supply gaps | Telegram/email |
| Weekly | City roundup content; source ROI; experiment readout; price index update | Show feed + bookings |
| Monthly | Cohort retention, partner payouts, city expansion scorecard | D1 |

### 4.2 What stays human (one tap, not manual work)

1. **First cold touch** on email/DM/phone — approve a pre-written message.
2. **Public posts/replies** on Reddit/X/Instagram — review before publishing.
3. **New campaign copy and targeting** — approve once per campaign, not per send.

Everything else (sourcing, ranking, drafting, scheduling, follow-up timing, reporting) is
automatic. This is what "without human involvement" can honestly mean in 2026.

### 4.3 New data the system needs

```
intent_signals    id, source, url, author, city, category, event_date, text,
                  intent_score, status, dedupe_key, created_at
outreach_queue    id, lead_id / signal_id, channel, draft, status, approved_by,
                  sent_at, replied_at, touch_no
outreach_touches  id, lead_id, channel, template, touch_no, sent_at, opened_at,
                  replied_at, outcome, unsubscribe_token
suppressions      email / domain / phone, reason, created_at
consents          subject, channel, purpose, granted_at, source, withdrawn_at
attributions      booking_id, source, campaign, partner_code, first_touch_at
partner_referrals partner_id, code, booking_id, fee_inr, status
```

Add these in `schema.sql`; keep migrations idempotent, as the existing `ensure*Schema` functions do.

### 4.4 The scoring model (simple, explainable)

```
intent_score =
  city_match       40
+ category_match   25
+ date_within_30d  15
+ explicit_buying  10   // "looking for", "need", "budget", "recommend"
+ verified_contact 10
- already_contacted 100
- suppressed         100
```

Route ≥70 to the owner immediately; 40–69 into a daily digest; below 40 stay in the pool. Log
every score reason, so the operator can see why a lead surfaced. No black-box ranking.

---

## 5. Channel playbooks (compliant by design)

### Email — own the relationship, not the cold list
- **Resend stays for transactional and opt-in only.** Move cold B2B outreach off it.
  Use phone/Instagram manual outreach for first contact, or a separate outbound domain/provider
  that explicitly permits B2B cold email with unsubscribe — with legal review, not by default.
- Add `List-Unsubscribe`, a one-click `/unsubscribe?token=` route, suppression table, bounce and
  complaint handling. Honor opt-outs immediately.
- Sequences: venue interest day 0 (shortlist), day 2 (three acts + prices), day 7 ("still
  planning?"), day 21 (seasonal idea). Artist activation: day 1 profile checklist, day 3 "add
  clips", day 7 "first gig" nudge. Post-booking: day 1 thank-you, day 7 review, day 30 rebook,
  anniversary.
- Measure per template: delivered, reply, booking. Kill templates below 2% reply after 200 sends.

### WhatsApp — where Indian gigs actually close
- Use **Cloud API via an official BSP**; capture explicit opt-in on the venue form, booking flow
  and request pages ("WhatsApp updates about your enquiry — yes/no").
- Templates: enquiry received, shortlist ready, artist confirmed, event reminder, payment/escrow
  update, review request. Marketing templates only to opted-in numbers, with stop handling.
- Click-to-chat ads and venue QR codes are the acquisition path — not cold blasts.
- Budget guard: utility ≈ ₹0.115, marketing ≈ ₹0.86 per delivered message; the 250-recipient/24h
  portfolio cap is a natural throttle.

### Instagram — content and comment-to-DM, never cold DMs
- Publish 3–5 posts/week from real bookings and show feeds: act clips, venue nights, city
  roundups, "booked this week".
- Turn on comment-to-DM for a specific keyword ("PUNE") → one private reply with a shortlist link
  → the person replies → 24h window opens. That is compliant and high-intent.
- Every artist profile gets a shareable Mehfil link for their bio (loop already in `plan.txt`).
- Track saves/shares and profile-link clicks, not just likes.

### Reddit — listen and participate, never automate DMs
- Apply for API access; treat approval as gated. Start with **Google Alerts RSS / manual search**
  for "DJ for wedding Pune", "live band cafe Mumbai", "open mic Jaipur".
- The owner replies in-thread with disclosure and only where community rules permit. Log the
  source URL and outcome; do not mass-post listings.
- City subreddits are better for event announcements than for sales.

### X — publish and reply to inbound; skip the bots
- Post city roundups, booking stories and act spotlights; reply to people who engage.
- No keyword auto-replies, no cold DMs. API is pay-per-use; a URL post costs ~$0.20, so keep
  links in the profile/bio rather than every post.

### SEO — the compounding channel already built
- 96 pages exist; expand the matrix with **weddings** (sangeet, mehndi, reception), **corporate**
  (annual day, offsite, Diwali), **last-minute**, and **budget** modifiers.
- Add `FAQPage`, `Service` and `Offer` schema; publish real price ranges from bookings (with
  consent) instead of static copy.
- Weekly city roundup page: "Live music in Pune this week" from the shows feed — fresh content,
  internal links to artist pages, newsletter and social source in one asset.

### Partnerships — the highest-ticket loop
- Planner/banquet/decorator referral codes with a tracked fee (extend `referrals`).
- Music schools and equipment rentals: supply + add-on revenue.
- Venue groups (multi-outlet cafés) get a dashboard and a recurring-night contract.

### Paid ads — only where the math works
- Google Search on high-intent wedding/corporate queries; Meta retargeting for venue interest.
- Start ₹10–15k/month, one city, one segment; kill anything above a 60-day CAC payback.
- Feed ad-source conversions back into `attributions`; do not scale on platform-reported numbers.

---

## 6. Build backlog

### P0 — protect the base (this week)
1. **Consent and suppression layer**: `consents`, `suppressions`, unsubscribe route + header,
   bounce/complaint logging.
2. **Stop cold email through Resend**: gate `contactLead` on consent; keep Telegram alerts for
   manual first touch. This is a one-line policy gate with a big risk reduction.
3. **Outreach caps and quiet hours**: 20 emails/day/domain max, 09:00–19:00 IST, dedupe touches,
   no more than 3 touches per lead.
4. **Attribution**: persist `source`, `campaign`, partner code on leads and bookings; UTMs on
   every outbound link.
5. **Fix "sent" semantics**: a Telegram ping is not outreach; log `queued` vs `sent` honestly.

**Status (25 Oct 2026):** 1, 2, 3 and 5 are implemented in `worker/lifecycle.js` and `worker/leads.js`
(consent, suppression, one-click unsubscribe, send caps/quiet hours, cold-outreach queue). Venue
shortlist and rebooking sequences are live too; automated tests cover all of it. Attribution (item 4)
remains open.

### P1 — convert what already exists (2–4 weeks)
6. **Lifecycle sequences** for `venue_interest`, artist activation, bookings and rebooking.
7. **Intent inbox** (`/growth`, owner-only): signals from Google Alerts RSS/Reddit/X search →
   score → draft reply → one-tap approve; track reply and booking.
8. **Market pulse**: daily/weekly supply-demand gaps (city × category), price ranges, source ROI;
   surface in `/engines` and the digest.
9. **Partner referrals**: planner/banquet codes, payout ledger, leaderboard.
10. **Weekly content engine**: city roundup from shows + new artists → SEO page, newsletter,
    IG/X drafts (all reviewed once, then scheduled).
11. **Urgent gig tier**: ≤72h requests → matched-artist WhatsApp/Telegram alert + venue call list.

### P2 — scale channels (1–2 months)
12. **WhatsApp Cloud API**: opt-in, templates, inbound webhook, click-to-chat.
13. **Instagram comment-to-DM** and inbound messaging.
14. **Paid ads automation** with budget guardrails and CAC feedback.
15. **AI shortlist/quote agent**: request → 3 matched acts with prices/availability → human
    approves; later auto-quotes within owner-set bands.
16. **Price intelligence**: anonymized booking rates by city/category/season; powers SEO pages,
    quote suggestions and supply negotiation.

---

## 7. Metrics and guardrails

**North star:** confirmed bookings per month.

| Funnel | Metric | Target (first 90 days) |
|---|---|---|
| Supply | verified artists per active city | 300–500 in launch city |
| Demand | qualified venue/wedding leads per week | 40 |
| Activation | venue interest → shortlist sent | ≥80% within 48h |
| Conversion | shortlist → booking request | ≥15% |
| Retention | rebook within 90 days | ≥25% |
| Content | organic sessions to `/in/*` | +30% MoM |
| Referral | bookings from partner/artist codes | ≥15% of total |

**Guardrails:** bounce <2%, spam complaints <0.1%, unsubscribe <1%, WhatsApp quality green,
zero platform strikes, no cold sends through Resend. If a guardrail trips, automation pauses and
the digest says why.

**Experiment discipline:** one variable per test (subject, offer, send time), minimum 200 sends or
4 weeks, pre-registered success metric. Log results in `outreach_touches` so the next template is
chosen from evidence, not opinion.

---

## 8. First 30 / 60 / 90 days

**Days 0–30 — fix the base and harvest existing demand**
- Ship P0 compliance and attribution.
- Launch venue nurture and artist activation; email every `venue_interest` row with a shortlist.
- Convert 20 venue pilots with a paid, measured offer.
- Add wedding/corporate pages to the SEO matrix; publish two city roundups.
- Instrument the funnel end to end.

**Days 31–60 — add intent and partners**
- Intent inbox with Google Alerts RSS + Reddit search; 10 approved replies/week.
- Planner/banquet referral codes; 10 partner conversations.
- WhatsApp inbound for booking updates (opt-in only).
- Weekly market pulse to the owner.

**Days 61–90 — scale what converts**
- Paid search on wedding/corporate only; kill above CAC threshold.
- Instagram comment-to-DM + 3 posts/week from real bookings.
- AI shortlist drafts; price intelligence v1.
- Second city depth only after the first city hits supply and rebook targets.

---

## 9. What not to build

- Cold DM bots on Instagram/X/Reddit/LinkedIn; bulk follows; scraped-profile messaging. These
  are account-ending, not growth.
- Purchased lists or scraping emails for Resend campaigns.
- Keyword auto-replies pretending to be human.
- Fake reviews, fake urgency, fake availability.
- More channels before the existing leads convert. The database already contains unworked demand.

The honest version of "fully automated" is: the machine finds, scores, drafts, schedules, follows
up and reports; a human taps approve on the first cold touch. That is also the version that keeps
reply rates and the brand intact.

---

## Sources

- EY / BookMyShow, India's live-event segment ₹12,000 cr in 2024, ~19% growth —
  https://www.ey.com/en_in/insights/media-entertainment/india-s-rising-concert-economy-a-new-era-of-live-entertainment
- FICCI–EY, organised live events +44% in 2025 —
  https://www.ficci.in/press_release_details/5190
- Music Ally, BookMyShow 34,086 events in 2025; 562,032 fans travelled —
  https://musically.com/2025/12/11/over-34k-events-mous-and-record-breaking-gigs-bookmyshows-year-in-live-entertainment/
- EVENTFAQS, Jaipur live-event footfall +33% —
  https://in.eventfaqs.com/2025/12/12/bookmyshow-unveils-throwback-2025-a-landmark-year-where-entertainment-became-a-movement/
- Grand View Research, India wedding services US$103.9 bn, 84.4% local, 51% word of mouth —
  https://www.grandviewresearch.com/industry-analysis/india-wedding-services-market-report
- CAIT, 46 lakh weddings / ₹6.5 lakh crore (Nov 2025) —
  https://cait.in/wedding-season-2025-to-generate-%E2%82%B96-5-lakh-crore-business-from-46-lakh-weddings-across-india-cait-delhi-alone-to-witness-%E2%82%B91-8-lakh-crore-trade-from-4-8-lakh-weddings-indian/
- Mochsha, gig cost guide (Jan 2025) —
  https://www.mochsha.in/post/how-to-estimate-gig-costs-a-guide-for-musicians-and-clients
- StarClinch, singer price guide (Nov 2025) —
  https://starclinch.com/blog/singer-booking-price-list-india/
- BMT Agency, wedding artist guide (Jul 2025) —
  https://bmtagency.in/a-guide-to-book-artists-for-weddings-in-india/
- Fortune India, venue shortage / tier-2 — https://www.fortuneindia.com/business-news/india-can-become-a-global-live-entertainment-hub-with-2530-new-venues-waveswhitepaper/122713
- Resend Acceptable Use Policy — https://resend.com/legal/acceptable-use
- WhatsApp opt-in — https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- WhatsApp pricing — https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Instagram private replies — https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies
- X automation rules — https://help.x.com/en/rules-and-policies/x-automation
- Reddit Data API terms — https://redditinc.com/policies/data-api-terms
- LinkedIn automated activity policy — https://www.linkedin.com/help/linkedin/answer/a1340567
- DPDP Act overview — https://www.dlapiperdataprotection.com/?t=law&c=IN
- TRAI TCCCPR — https://trai.gov.in/tcccpr
