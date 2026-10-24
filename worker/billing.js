// Pure money + matching logic — no D1, no Hono: importable from node tests.
import { ARTIST_FEE_PCT } from "./util.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

export const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/**
 * Split a payout across recipients.
 * @param {number} net   total rupees to distribute
 * @param {{user_id:string, split_pct:number}[]} recipients  must sum to 100
 *   (solo artists are represented as [{user_id, split_pct:100}]).
 * Largest-remainder rounding: rows always sum back to exactly `net`.
 */
export function distributeNet(net, recipients) {
  const total = recipients.reduce((s, r) => s + Number(r.split_pct || 0), 0);
  if (!recipients.length || total <= 0) return [];
  const raw = recipients.map((r) => ({
    ...r,
    exact: (net * Number(r.split_pct)) / total,
  }));
  const floors = raw.map((r) => ({ ...r, share: Math.floor(r.exact) }));
  let leftover = Math.round(net) - floors.reduce((s, r) => s + r.share, 0);
  // Hand the leftover rupees to the largest fractional remainders first.
  const byFrac = [...floors].sort((a, b) => (b.exact - b.share) - (a.exact - a.share));
  for (const r of byFrac) {
    if (leftover <= 0) break;
    r.share += 1;
    leftover -= 1;
  }
  return floors.map(({ user_id, split_pct, share }) => ({
    user_id,
    split_pct: Number(split_pct),
    net: share,
  }));
}

/** Payout rows for a completed booking: artist commission first, then split. */
export function payoutPlanForBooking({ booking, recipients }) {
  const gross = Number(booking.amount_inr);
  const fee = Math.round((gross * ARTIST_FEE_PCT) / 100); // artist-side commission
  const net = gross - fee;
  return {
    gross,
    fee,
    net,
    rows: distributeNet(net, recipients).map((r) => ({ ...r, kind: "gig" })),
  };
}

/** Tip: 100% passes through to recipients in this phase (plan takes a cut at P3). */
export function tipPlanForBooking({ amount, recipients }) {
  const gross = Math.round(Number(amount) || 0);
  return {
    gross,
    fee: 0,
    net: gross,
    rows: distributeNet(gross, recipients).map((r) => ({ ...r, kind: "tip" })),
  };
}

// ------------------------------------------------------------- smart match --

const STOP = new Set([
  "the","and","for","with","need","want","artist","artists","book","booking","hire",
  "hiring","please","party","event","our","we","a","an","in","on","at","of","to","is",
  "are","my","me","you","this","that","some","get","who","can","i","it","for","night",
]);

const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Score every artist against a free-text brief + optional constraints.
 * Returns top 5 with human-readable reasons (plan's P2 "smart match").
 */
export function smartMatch(artists, { brief = "", city = "", budget = 0, limit = 5 } = {}) {
  const want = [...new Set(tokens(brief))];
  const scored = artists
    .map((a) => {
      let score = 0;
      const reasons = [];
      const hay = [
        ...(a.sub_skills || []),
        ...(a.languages || []),
        a.stage_name,
        a.bio,
        a.category,
        a.city,
      ]
        .join(" ")
        .toLowerCase();

      if (city && a.city === city) {
        score += 28;
        reasons.push(`based in ${a.city}`);
      }
      if (budget > 0) {
        if (a.base_price_inr <= budget) {
          score += 26;
          reasons.push(`from ${inr(a.base_price_inr)}, inside ${inr(budget)}`);
        } else {
          const over = (a.base_price_inr - budget) / budget;
          score += Math.max(0, 12 - over * 20);
        }
      }
      const matched = want.filter((t) => hay.includes(t));
      score += Math.min(48, matched.length * 14);
      if (matched.length) reasons.push(`matches: ${matched.slice(0, 4).join(", ")}`);
      score += Number(a.rating || 0) * 4;
      if (a.rating >= 4.5 && a.reviews_count > 0) reasons.push(`${Number(a.rating).toFixed(1)}★ from ${a.reviews_count} reviews`);
      if (a.verified) score += 5;
      score += Math.min(9, Number(a.gigs_done || 0) / 30);
      return { artist: a, score: Math.round(score * 10) / 10, reasons };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
  return scored;
}

// ----------------------------------------------------------------- invoice --

export function renderInvoice({ booking, artist, host, payouts = [], team = null, members = [] }) {
  const isCancelled = ["cancelled"].includes(booking.status);
  const invoiceNo = `MF-${booking.event_date.slice(0, 4)}-${booking.id.slice(-6).toUpperCase()}`;
  const memberName = (id) => members.find((m) => m.user_id === id)?.name || id;
  const rows = payouts
    .map(
      (p) => `<tr>
        <td>${esc(p.kind === "tip" ? "Tip" : "Performance payout")}</td>
        <td>${esc(team && p.kind === "gig" ? `Team split ${p.split_pct}%` : "Solo performance")}</td>
        <td class="num">${inr(p.gross)}</td>
        <td class="num">${inr(p.fee)}</td>
        <td class="num strong">${inr(p.net)}</td>
        <td>${esc(team && p.kind !== "tip" ? memberName(p.user_id) : team ? memberName(p.user_id) : artist.stage_name)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(invoiceNo)} — Mehfil</title>
<style>
  body{font:15px/1.55 Inter,Georgia,serif;color:#241a2e;background:#fbf6ee;margin:0;padding:32px}
  .sheet{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e9e0d3;border-radius:14px;padding:34px}
  h1{font:700 26px Georgia,serif;margin:0 0 2px}
  .muted{color:#5d5170}.small{font-size:13px}
  .head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #17101f;padding-bottom:16px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  th,td{padding:9px 10px;border-bottom:1px solid #eee4d6;text-align:left;font-size:13.5px}
  th{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#8b8199}
  .num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}
  .badge{display:inline-block;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;background:#e7f8f0;color:#0a7a52}
  .badge.void{background:#fdeaec;color:#b3182c}
  .totals td{border:none;font-size:14px}
  .note{background:#fdf6e7;border-left:3px solid #f5a623;padding:10px 14px;border-radius:0 8px 8px 0;font-size:13px;color:#6b4c0c;margin-top:18px}
  @media print{body{background:#fff;padding:0}.sheet{border:none}}
</style></head><body>
<div class="sheet">
  <div class="head">
    <div>
      <h1>Mehfil</h1>
      <div class="small muted">Artist Hiring &amp; Collaboration Platform — statement for services rendered</div>
    </div>
    <div style="text-align:right">
      <div class="small muted">Invoice</div>
      <div style="font-weight:800;font-size:18px">${esc(invoiceNo)}</div>
      <span class="badge ${isCancelled ? "void" : ""}">${isCancelled ? "CANCELLED — not a tax invoice" : booking.status.toUpperCase()}</span>
    </div>
  </div>

  <table style="margin-top:0">
    <tr><th>Billed by (artist)</th><th>Billed to (host)</th></tr>
    <tr>
      <td><b>${esc(artist.stage_name)}</b>${team ? `<br>Team: ${esc(team.name)}` : ""}<br>${esc(artist.city)}${team ? "" : "<br>GSTIN: not registered (individual)"}</td>
      <td><b>${esc(host.name)}</b><br>${esc(booking.city)}${host.email ? `<br>${esc(host.email)}` : ""}</td>
    </tr>
  </table>

  <table>
    <tr><th>Scope</th><th>Date</th><th>Venue</th></tr>
    <tr><td>${esc(booking.package_name)} — ${esc(booking.event_type)}</td><td>${esc(booking.event_date)} ${esc(booking.start_time)}</td><td>${esc(booking.venue || booking.city)}</td></tr>
  </table>

  <table>
    <thead><tr><th>Line item</th><th>Basis</th><th class="num">Gross</th><th class="num">Platform fee</th><th class="num">Net payout</th><th>Recipient</th></tr></thead>
    <tbody>
      ${rows || `<tr><td colspan="6" class="muted small">${isCancelled ? "No payout — booking cancelled and advance refunded." : "Payout recorded when the event completes and escrow releases."}</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="totals"><td colspan="4" class="num muted">Booking total (host paid)</td><td class="num strong">${inr(booking.amount_inr)}</td><td></td></tr>
      <tr class="totals"><td colspan="4" class="num muted">Host fee (${5}%)</td><td class="num">${inr(Math.round(booking.amount_inr * 0.05))}</td><td></td></tr>
      <tr class="totals"><td colspan="4" class="num muted">Escrow advance held (40%)</td><td class="num">${inr(booking.advance_inr)}</td><td></td></tr>
    </tfoot>
  </table>

  <div class="small muted">Cancellation policy at booking: <b>${esc(booking.policy)}</b>. Contract terms, event brief and full timeline are attached to this booking in the app.</div>
  <div class="note"><b>Demo build:</b> this statement is generated for demonstration — no real money moved, GSTIN/TDS fields are placeholders. In production Mehfil issues GST invoices from its registered entity.</div>
  <div class="small muted" style="margin-top:14px">Print or save as PDF from your browser · <a href="/bookings/${esc(booking.id)}">open booking</a></div>
</div>
</body></html>`;
}
