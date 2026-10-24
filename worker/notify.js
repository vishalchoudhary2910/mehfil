// Telegram notifications + an auditable notify_log. Never throws when a token
// isn't configured — the cron keeps running and just records "not_configured".

export function telegramConfigured(env) {
  return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export const esc = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(env, text, opts = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = opts.chatId || env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { sent: !!data.ok, status: res.status, error: data.description || null };
  } catch (e) {
    return { sent: false, error: String(e && e.message ? e.message : e).slice(0, 140) };
  }
}

export async function logNotify(env, { channel = "telegram", chat_id, topic, payload, status, error }) {
  try {
    await env.DB.prepare(
      "INSERT INTO notify_log (channel, chat_id, topic, payload, status, error) VALUES (?,?,?,?,?,?)"
    )
      .bind(channel, chat_id || null, topic || null, String(payload || "").slice(0, 2000), status || "sent", error || null)
      .run();
  } catch {
    // notify_log may not exist yet on a very old DB; never let logging break send.
  }
}

// Send + record in one call. Returns { sent, reason?, error? }.
export async function notify(env, text, topic) {
  const r = await sendTelegram(env, text);
  await logNotify(env, {
    topic,
    payload: text,
    status: r.sent ? "sent" : r.reason || "failed",
    error: r.error,
  });
  return r;
}

const kindTag = { venue: "📍 Venue", artist: "🎤 Artist", client: "💼 Client" };

export function leadMessage(lead, reason) {
  const lines = [
    `<b>Mehfil Leads</b> · ${esc(reason)}`,
    `${kindTag[lead.kind] || esc(lead.kind)} · <b>${esc(lead.name)}</b>`,
    [lead.category, lead.area, lead.city].filter(Boolean).map(esc).join(" · "),
  ];
  if (lead.phone) lines.push(`📞 ${esc(lead.phone)}`);
  if (lead.website) lines.push(`🌐 ${esc(lead.website)}`);
  if (lead.email) lines.push(`✉️ ${esc(lead.email)}`);
  if (lead.instagram) lines.push(`📸 @${esc(String(lead.instagram).replace(/^@/, ""))}`);
  return lines.filter(Boolean).join("\n");
}

export function digestMessage(s) {
  const lines = [
    `<b>Mehfil Leads — daily digest</b>`,
    `🆕 ${s.new_leads} new · ✅ ${s.verified} verified · ⛔ ${s.invalid} invalid`,
    `🤝 ${s.matches} new matches · 📣 ${s.outreach} contacted`,
    s.places_key ? `📍 Places sync: ${s.places_new} new, ${s.places_updated} updated` : `📍 Places sync: skipped (no key)`,
  ];
  if (s.expired || s.removed) {
    lines.push(`🧹 ${s.expired || 0} stale leads expired · ${s.removed || 0} purged after 180 days`);
  }
  if (s.top && s.top.length) {
    lines.push("", "<b>Top new leads:</b>");
    for (const l of s.top) {
      lines.push(`• ${esc(l.name)} — ${[l.category, l.city].filter(Boolean).map(esc).join(", ")} (${esc(l.verification)})`);
    }
  }
  if (s.match_pairs && s.match_pairs.length) {
    lines.push("", "<b>Suggested matches:</b>");
    for (const p of s.match_pairs) {
      lines.push(`• <b>${esc(p.lead.name)}</b> (${[p.lead.category, p.lead.city].filter(Boolean).map(esc).join(", ")}) ↔ ${p.names.map(esc).join(", ")}`);
    }
  }
  if (!telegramConfigured({ TELEGRAM_BOT_TOKEN: s._tok, TELEGRAM_CHAT_ID: s._chat })) {
    // no-op; caller decides whether to warn. Kept for clarity.
  }
  return lines.join("\n");
}
