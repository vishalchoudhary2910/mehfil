// Email adapters (Resend) — outreach, gig invitations, reminders and host
// updates. Active only when RESEND_API_KEY + RESEND_FROM are set; every
// caller gets { sent, reason } and falls back to Telegram/in-app otherwise.
// Dependency-free (raw fetch) so it bundles clean in Workers.

export const emailConfigured = (env) => !!(env.RESEND_API_KEY && env.RESEND_FROM);

export async function sendEmail(env, { to, subject, text, replyTo }) {
  if (!to) return { sent: false, reason: "no_recipient" };
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [to],
        subject: subject.slice(0, 180),
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { sent: false, provider: "resend", status: res.status, error: t.slice(0, 160) };
    }
    return { sent: true, provider: "resend" };
  } catch (e) {
    return { sent: false, provider: "resend", error: String(e && e.message ? e.message : e).slice(0, 160) };
  }
}

export function composeOutreach(lead, actor = "Mehfil") {
  const city = lead.city || "your city";
  const subject = `Verified live performers for ${lead.name} — Mehfil`;
  const text =
    `Hi ${lead.name} team,\n\n` +
    `We're Mehfil — we connect cafes, clubs, banquets and private events with verified DJs, singers, ` +
    `bands, poets and anchors across India.\n\n` +
    `${lead.name} looked like a great fit for live music in ${city}. Would you like a shortlist of ` +
    `verified performers — with rates, dates and short bios — for an upcoming night or season?\n\n` +
    `No commitment. Just reply with the vibe and date range you have in mind.\n\n` +
    `— ${actor}, Mehfil`;
  return { subject, text };
}

export async function sendOutreachEmail(env, lead, actor) {
  if (!lead.email) return { sent: false, reason: "no_email" };
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeOutreach(lead, actor);
  return sendEmail(env, { to: lead.email, subject, text });
}

// ---------------------------------------------------------- gig requests ---

export function composeRequestInvite({ artistName = "there", request, url }) {
  const when = `${request.date}${request.start_time ? ` at ${request.start_time}` : ""}`;
  const budget = request.budget_inr ? `Budget: ₹${Number(request.budget_inr).toLocaleString("en-IN")}\n` : "Budget: open — send your quote\n";
  const subject = `${request.category || "Performer"} needed in ${request.city} on ${when} — are you available?`;
  const text =
    `Hi ${artistName},\n\n` +
    `Mehfil has a direct gig enquiry that matches your act.\n\n` +
    `What: ${request.event_type || request.category} — ${request.category}\n` +
    `Where: ${[request.area, request.city].filter(Boolean).join(", ")}\n` +
    `When: ${when}\n` +
    budget +
    (request.brief ? `Brief: ${request.brief}\n` : "") +
    `\nTell us in one click if you're available, maybe available, or booked:\n${url}\n\n` +
    `You can reply with a quote and a short note — no account needed to respond.\n\n` +
    `— Mehfil gig requests`;
  return { subject, text };
}

export async function sendRequestInvite(env, { to, artistName, request, url }) {
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeRequestInvite({ artistName, request, url });
  const r = await sendEmail(env, { to, subject, text, replyTo: request.host_email || undefined });
  return r;
}

export function composeReminder({ artistName = "there", request, url, urgent = false }) {
  const subject = urgent
    ? `Still looking for a ${request.category} in ${request.city} — can you make ${request.date}?`
    : `Reminder: ${request.category} gig in ${request.city} on ${request.date}`;
  const text =
    `Hi ${artistName},\n\n` +
    `Quick reminder about a gig enquiry in ${request.city} on ${request.date}` +
    `${request.start_time ? ` at ${request.start_time}` : ""}.\n\n` +
    (request.budget_inr ? `Budget: ₹${Number(request.budget_inr).toLocaleString("en-IN")}\n` : "Budget: open — quote your rate\n") +
    `\nAvailability takes 10 seconds: ${url}\n\n` +
    `If you're not available, one tap to decline keeps our matches accurate.\n\n` +
    `— Mehfil gig requests`;
  return { subject, text };
}

export async function sendReminder(env, { to, artistName, request, url, urgent }) {
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeReminder({ artistName, request, url, urgent });
  return sendEmail(env, { to, subject, text });
}

export function composeHostUpdate({ request, event, target, url }) {
  const head = {
    found: `You have a performer available for ${request.city} on ${request.date}`,
    confirmed: `Booked: ${target?.name || "your performer"} for ${request.date}`,
    expired: `Your gig request for ${request.date} expired with no confirmation`,
    response: `New response to your ${request.category} request`,
  }[event] || `Update on your gig request for ${request.date}`;
  const lines = [`Hi ${request.host_name || "there"},`, "", head + "."];
  if (target) {
    lines.push("", `Performer: ${target.name}`);
    if (target.quote_inr) lines.push(`Quote: ₹${Number(target.quote_inr).toLocaleString("en-IN")}`);
    if (target.message) lines.push(`Note: ${target.message}`);
    if (event === "confirmed" && (target.email || target.phone)) {
      lines.push(`Contact: ${[target.email, target.phone].filter(Boolean).join(" · ")}`);
    }
  }
  lines.push("", `Open the request: ${url}`, "", "— Mehfil gig requests");
  return { subject: head, text: lines.join("\n") };
}

export async function sendHostUpdate(env, { to, request, event, target, url }) {
  if (!to) return { sent: false, reason: "no_recipient" };
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeHostUpdate({ request, event, target, url });
  return sendEmail(env, { to, subject, text });
}

// ------------------------------------------------------- request threads --

export function composeThreadMessage({ request, from = "host", body = "", url = "" }) {
  const subject = `${request.host_name || "The host"} · ${request.category || "gig"} in ${request.city}`;
  const text =
    `New message about the gig on ${request.date}${request.start_time ? ` at ${request.start_time}` : ""}:\n\n` +
    `${body}\n\n` +
    (url ? `Reply here: ${url}\n\n` : "") +
    `— Mehfil gig requests`;
  return { subject, text };
}

export async function sendThreadMessage(env, { to, request, from, body, url }) {
  if (!to) return { sent: false, reason: "no_recipient" };
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeThreadMessage({ request, from, body, url });
  return sendEmail(env, { to, subject, text });
}

// ----------------------------------------------------------------- alerts --

export function composeAlert({ kind, city, items }) {
  const label = { artists: "new artists", shows: "new shows", leads: "new gig leads", jams: "new jam sessions" }[kind] || "new matches";
  const subject = `${items?.length || 0} ${label}${city ? ` in ${city}` : ""} — Mehfil`;
  const lines = [`Mehfil alert: ${label}${city ? ` in ${city}` : ""}`, ""];
  for (const it of items || []) lines.push(`• ${it.title}${it.meta ? ` — ${it.meta}` : ""}${it.url ? `\n  ${it.url}` : ""}`);
  lines.push("", "— Mehfil alerts");
  return { subject, text: lines.join("\n") };
}

export async function sendAlertEmail(env, { to, kind, city, items }) {
  if (!to) return { sent: false, reason: "no_recipient" };
  if (!emailConfigured(env)) return { sent: false, reason: "no_provider" };
  const { subject, text } = composeAlert({ kind, city, items });
  return sendEmail(env, { to, subject, text });
}
