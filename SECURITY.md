# Security policy

Mehfil handles bookings, payment-shaped escrow state, contact details and
one-to-one outreach. This document states what is implemented, how to report a
problem, and — just as importantly — what these controls do **not** promise.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- Use **GitHub → Security → Report a vulnerability** on this repository
  (private advisory), or
- contact the repository owner through the private channel they published.
- If private reporting is not enabled, open a minimal issue asking for a
  private channel — do not include reproduction details in public.

Include the affected route or file, the request that reproduces it, and the
impact you believe it has. You will get an acknowledgement, a fix or a written
explanation of why the behaviour is intentional.

## Session model

- Authentication is delegated to **Sign in with Freebuff** (`@freebuff/auth`),
  an OIDC flow. Mehfil never sees or stores a password, and there is no
  password reset surface to attack.
- The session lives in an **HttpOnly cookie issued by the auth SDK**. The React
  app never reads it, never copies a token into `localStorage`/`sessionStorage`,
  and the browser bundle contains no credential.
- Every private API route calls `auth.getUser(request)` on the server and then
  resolves the local user row itself. A client-supplied user id is never
  trusted for ownership decisions.
- `src/session.jsx` is the single fetch wrapper. A `401` from any route clears
  the client's session state and shows “session expired”; returning to a tab
  after more than a minute re-checks `/api/me`. Gated routes use `RequireAuth`.
- Sign-out is performed by the auth SDK's `SignOutButton`; the server-side
  cookie is cleared by that flow, not by client JavaScript.

## Access control

- Gated pages (`/book`, `/bookings`, `/dashboard`, `/join`, `/leads`,
  `/engines`, `/match`, `/messages`) render behind `RequireAuth`, but the
  actual authority is the API: each route re-authenticates and re-checks
  ownership.
- Operator surfaces (leads, engine room, show-feed console) are limited to
  `LEAD_OWNER_EMAILS`. **Production defaults to closed:** if that variable is
  unset on an `https://` origin, the consoles answer `403`. Loopback
  development is open so a fresh clone works without configuration.
- Booking actions are scoped to the booking's host/artist; reviews require a
  completed booking by that reviewer; invitations use unguessable tokens and
  are single-purpose.
- `POST`/`PUT`/`PATCH`/`DELETE` routes reject foreign origins with `403` via
  `isSameOriginRequest` (an Origin/Sec-Fetch-Site check), which is the app's
  CSRF control. Two deliberate exceptions carry their own protection: the
  RFC 8058 one-click unsubscribe `POST` (unguessable `ut_` token, idempotent,
  no cookies) and its matching `GET` link.

## Implemented controls

| Area | Control | Where |
|---|---|---|
| Transport | HSTS (only on https origins), no mixed content (`default-src 'self'`) | `worker/security.js` |
| Browser isolation | CSP with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action` allowlist; `X-Frame-Options: DENY`; COOP/CORP; `nosniff`; restrictive `Permissions-Policy` | `worker/security.js`, applied to every response in `worker/index.js` |
| CSRF | Same-origin enforcement on every mutation | all `worker/*.js` routers |
| Rate limiting | D1-backed fixed windows keyed by a **salted SHA-256 of the IP** (no raw IPs stored): venue brief 6/15 min, gig brief 10/h, artist self-listing 4/h, plus 5 gig requests/h per connection stored as a 96-bit IP hash | `worker/security.js`, `requests.js`, `growth.js`, `talent.js` |
| Form abuse | Hidden honeypot fields (visually hidden, not `display:none`) on public brief/claim/listing forms | `Venues.jsx`, `Need.jsx`, `Claim.jsx` |
| SSRF | Operator-supplied feed URLs restricted to public http(s) on 80/443, no credentials, no loopback/private/link-local/metadata hosts; redirects followed manually, max 4, re-validated each hop | `worker/security.js`, `worker/showfeed.js` |
| Injection | Parameterised D1 statements throughout; no string-built SQL; React escapes all text; no `dangerouslySetInnerHTML` in the SPA | `worker/`, `src/` |
| Data exposure | Every JSON response leaving the Worker is `Cache-Control: private, no-store` (enforced in the egress middleware); no tokens or PII in client storage | `worker/security.js` |
| Secrets | Server-only env vars / Sites Secrets; `.env*`, `.dev.vars`, `dist`, Wrangler state git-ignored | `.gitignore`, `wrangler.jsonc` |
| XSS surface | `script-src 'self'` (no inline scripts, no third-party script CDNs), `style-src` allows only self + Google Fonts inline styles, images limited to `self`/`data:`/https; server-rendered JSON-LD escapes `<` so a stage name cannot close the tag | `worker/security.js`, `seo.js`, `share.js` |
| Source exposure | Production build emits **no source maps**; no source maps uploaded by the deploy manifest | `vite.config.js` |
| Email abuse | Consent records and suppression list, `List-Unsubscribe` + one-click unsubscribe, 09:00–19:00 IST send window, 40/day cap; cold outreach is queued, never auto-sent | `worker/lifecycle.js`, `mail.js` |
| Error handling | Route error boundary keeps the frame and offers reload; API errors return a message, not a stack trace | `src/App.jsx`, `worker/` |

### Rate-limit behaviour

`429` responses include `Retry-After` and `Cache-Control: no-store`. Limits are
per client (hashed IP) and per scope; they are a **brake, not a wall** — a
distributed attack can still consume Worker/D1 quota. Put Cloudflare WAF and
Bot Fight Mode in front of a production deployment for volumetric protection.

## OWASP Top 10 (2021) mapping

| Risk | How Mehfil addresses it |
|---|---|
| **A01 Broken Access Control** | Server-side auth on every private route; ownership scoping in SQL; owner-only consoles closed by default; tokenised, single-purpose invitation links; no user-id trust from the client |
| **A02 Cryptographic Failures** | No passwords or card data stored; OIDC session cookie; HSTS on https; IPs hashed before storage; provider-managed TLS and at-rest encryption |
| **A03 Injection** | Prepared statements with bound parameters everywhere; no dynamic SQL construction; React text escaping; CSP blocks inline script; no `eval`/`new Function` |
| **A04 Insecure Design** | Escrow/refund state machine with explicit transitions; rate limits and honeypots on anonymous forms; consent before outreach; demo payments clearly labelled |
| **A05 Security Misconfiguration** | Single header middleware on every response; CSP, framing, MIME, referrer and permissions policies; source maps off; least-privilege owner gates; secrets only server-side |
| **A06 Vulnerable Components** | Small dependency surface (Hono, React, router, auth SDK, Vite, Wrangler); lockfile committed; `npm audit` in the release checklist |
| **A07 Identification/Auth Failures** | Delegated OIDC; no password storage; session expiry handled in the UI and re-validated server-side; no credential in JavaScript |
| **A08 Software/Data Integrity** | Locked installs from `package-lock.json`; deploys only from this workspace's built output; `script-src 'self'` prevents third-party script injection; proprietary licence limits redistribution |
| **A09 Logging/Monitoring Failures** | Engine runs, lead events, request events and notification attempts are recorded; rate-limit counters are queryable; add Cloudflare analytics/alerting for production |
| **A10 SSRF** | Feed ingestion validates scheme, port, credentials, host and every redirect hop; cloud-metadata names and private ranges are denied |

## On “nobody can clone this with AI”

No browser-delivered application can be made unreadable to a determined person:
the JavaScript, CSS and HTML must be sent to the browser to run. Obfuscation
and anti-devtools tricks only raise effort briefly and break accessibility,
debugging and caching. Mehfil therefore relies on controls that actually hold:

1. **Legal** — [LICENSE](LICENSE) is proprietary, all rights reserved. Copying,
   redeploying or creating derivative works requires written permission.
2. **Repository** — keep the GitHub repository **private**. “Vibe coding” a
   clone starts with obtaining the source; a private repo removes that step.
   Forks and GitHub's ToS do not grant a licence to run the software.
3. **Crawler policy** — `/robots.txt` disallows the known model-training and
   answer-engine crawlers (GPTBot, CCBot, ClaudeBot, Google-Extended,
   PerplexityBot, Bytespider and others). This is a declaration of policy and
   is **not enforcement**; only Cloudflare Bot Management/WAF can block
   traffic that ignores it.
4. **Server-side authority** — keys, engines, data and business rules live in
   the Worker and D1. A copied front end has no API, no data and no keys.
5. **No source maps** — production bundles are minified and unaccompanied by
   readable source.

Deliberately **not** implemented: JavaScript obfuscation, devtools blockers,
right-click suppression, or “AI detection”. They provide no real protection,
harm usability, and create a false sense of security.

## Known limitations

- The signed-in end-to-end journey (book → accept → check-in → escrow release)
  has unit coverage but has not been exercised with a real Freebuff session in
  this browser. Treat the auth boundary as verified by code review and
  signed-out `401`/`403` tests, not by a completed live login.
- `robots.txt` directives are advisory. Determined scrapers ignore them.
- Rate limiting is best-effort and D1-backed; it is not a substitute for an
  edge WAF, and it does not stop a large distributed botnet.
- Public lead/venue details are collected for outreach; consent and suppression
  are enforced, but data-retention limits are a policy decision, not automated
  deletion (except engine purges such as jam sessions older than 30 days).
- The feed SSRF guard validates the URL literal, not DNS. A hostname that
  resolves to a private address depends on Cloudflare's egress blocking; feed
  configuration is operator-only for that reason. Do not hand that console to
  untrusted users.
- Demo payments, KYC and payouts are simulated. No real money or identity data
  should be handled by this build.
- Third-party links in user profiles (Instagram, YouTube, websites) are shown
  as text/links, not fetched or embedded, so they cannot execute in the origin.
- `npm audit --omit=dev` is clean. The dev-only Wrangler toolchain currently
  pulls a vulnerable `undici`; it runs on the build machine and is not part of
  the deployed Worker, but keep Wrangler current.

## Production hardening checklist

- [ ] Set `LEAD_OWNER_EMAILS` to the operator's verified account(s); confirm the
      leads/engines/show-feed consoles return `403` for everyone else.
- [ ] Keep the repository private; keep [LICENSE](LICENSE) intact.
- [ ] Put every secret in **Sites → Secrets** (or `.dev.vars` locally); never
      commit `.env*`, `.dev.vars` or built output.
- [ ] Enable Cloudflare WAF managed rules + Bot Fight Mode, and alert on 5xx /
      rate-limit spikes.
- [ ] If anonymous forms attract spam, add Cloudflare Turnstile to `/need`,
      `/venues`, `/list-your-act` (honeypots and rate limits stay in place).
- [ ] Run `npm audit --omit=dev` and `npm test` before each deploy; update
      lockfile dependencies deliberately.
- [ ] Enable GitHub private vulnerability reporting and Dependabot alerts.
- [ ] Export or back up the D1 database before schema changes.
- [ ] Re-test sign-in, sign-out, and one foreign-origin `POST` (expect `403`)
      on the deployed origin after every auth or header change.
