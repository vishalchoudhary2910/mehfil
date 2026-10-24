// Lead verification — decides whether a lead is real and reachable. Network
// calls (website fetch, DNS-over-HTTPS MX lookup) are injected so the decision
// logic is node-testable without a network.

export function emailSyntax(email) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e);
}

// Cloudflare DoH — a 15xx/10xx MX answer means the domain can receive mail.
// Returns true (has MX), false (definitively none), or null (unknown/error).
export async function hasMx(domain, dohFetch) {
  try {
    const res = await dohFetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: "application/dns-json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const ans = data.Answer || [];
    if (!ans.length) return data.Status === 3 ? false : null; // NXDOMAIN = no domain
    return ans.some((a) => a.type === 15) || ans.length > 0;
  } catch {
    return null;
  }
}

export async function checkWebsite(url, fetchImpl) {
  if (!url) return { ok: false, skip: true };
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "follow" });
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 80) };
  }
}

// Indian mobile: 10 digits starting 6-9, optionally with 91/0 prefix.
export function phoneValid(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return /^[6-9]/.test(d);
  if (d.length === 12 && d.startsWith("91")) return /^[6-9]/.test(d[2]);
  if (d.length === 11 && d.startsWith("0")) return /^[6-9]/.test(d[1]);
  return false;
}

// Best-effort Instagram check. Instagram blocks plain fetches, so treat a
// non-404 as "present"; a network error is unknown, not a fail.
export async function checkInstagram(handle, fetchImpl) {
  const h = String(handle || "").replace(/^@/, "").trim();
  if (!h) return { ok: false, skip: true };
  try {
    const res = await fetchImpl(`https://www.instagram.com/${h}/`, { method: "GET", redirect: "follow" });
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch {
    return { ok: null, unknown: true };
  }
}

// The decision function: given a lead's fields, run the applicable checks and
// return { verification, detail }. Rules:
//   - no contact channel at all            -> invalid
//   - any channel definitively broken and none good -> invalid
//   - at least one channel confirmed good and none broken -> verified
//   - otherwise                            -> unverified (worth a human look)
export async function verifyLead(lead, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const doh = deps.dohFetch || fetchImpl;
  const detail = {};

  if (lead.phone) detail.phone = phoneValid(lead.phone) ? "ok" : "invalid";
  if (lead.website) detail.website = await checkWebsite(lead.website, fetchImpl);
  if (lead.email) {
    const syn = emailSyntax(lead.email);
    if (!syn) detail.email = "syntax";
    else {
      const mx = await hasMx(lead.email.split("@")[1], doh);
      detail.email = mx === true ? "ok" : mx === false ? "no_mx" : "unknown_mx";
    }
  }
  if (lead.instagram) detail.instagram = await checkInstagram(lead.instagram, fetchImpl);

  const hasChannel = !!(lead.phone || lead.website || lead.email);
  if (!hasChannel) return { verification: "invalid", detail };

  const good =
    (lead.phone && detail.phone === "ok") ||
    (lead.website && detail.website && detail.website.ok) ||
    (lead.email && detail.email === "ok");
  const bad =
    (lead.phone && detail.phone === "invalid") ||
    (lead.email && (detail.email === "syntax" || detail.email === "no_mx"));

  let verification;
  if (good && !bad) verification = "verified";
  else if (bad && !good) verification = "invalid";
  else if (bad) verification = "invalid";
  else verification = "unverified";

  return { verification, detail };
}
