import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";

// The supply-side growth loop: recognized artists invite the unlisted acts
// they know. Two verified invites unlock the Founding Artist badge.
export default function Invite() {
  const { session, notify } = useSession();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api("/api/referral").then(setData).catch(() => setData({ error: 1 }));
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // A ?ref=CODE visit claims the attribution and starts the invitee's path.
  useEffect(() => {
    const ref = params.get("ref");
    if (!ref || !session || data?.claimed) return;
    api("/api/referral/claim", { method: "POST", body: JSON.stringify({ code: ref }) })
      .then(() => {
        notify("You were invited by a fellow artist — welcome!", "ok");
        load();
      })
      .catch(() => {});
  }, [params, session, data, load, notify]);

  const waText = encodeURIComponent(
    "Come join me on Mehfil — it's where hosts in India book artists. My link: " +
      (data?.url || "https://mehfil.in")
  );

  if (!session) {
    return (
      <div className="wrap" style={{ padding: "70px 20px", maxWidth: 620 }}>
        <div className="card center">
          <div style={{ fontSize: 36 }}>💌</div>
          <h2 className="mt-1">Invite your fellow artists</h2>
          <p className="muted">
            Bring the acts you know onto Mehfil. Two invites that list and verify unlock the
            Founding Artist badge on your profile — permanent early-access trust.
          </p>
          <Link to={`/login?returnTo=${encodeURIComponent("/invite")}`} className="btn btn-primary mt-2">
            Sign in to get your invite link
          </Link>
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="wrap" style={{ padding: 60 }}>
        <div className="empty">Loading your invite link…</div>
      </div>
    );
  }

  const { code, url, sent = 0, joined = 0, listed = 0, unlocked = false, invites = [] } = data;
  const goal = 2;
  const progress = Math.min(listed, goal);

  return (
    <div className="wrap" style={{ maxWidth: 720, padding: "50px 20px" }}>
      <div className="kicker">Artist invite loop</div>
      <h1>Bring the acts you know</h1>
      <p className="muted">
        The best acts in every city are still unlisted. Two fellow artists who join and verify
        through your link earn you the <b>Founding Artist</b> badge — and your city's scene gets
        a little bigger.
      </p>

      <div className="card mt-3">
        <div className="row between wrapline">
          <div>
            <div className="tiny muted">YOUR INVITE LINK</div>
            <code style={{ fontSize: 15, wordBreak: "break-all" }}>{url}</code>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                navigator.clipboard?.writeText(url).catch(() => null);
                notify("Link copied");
                setTimeout(() => setBusy(false), 600);
              }}
            >
              Copy
            </button>
            <a
              className="btn btn-primary btn-sm"
              href={`https://wa.me/?text=${waText}`}
              target="_blank"
              rel="noreferrer"
            >
              Share on WhatsApp
            </a>
          </div>
        </div>

        <div className="row mt-3" style={{ gap: 18, flexWrap: "wrap" }}>
          <Stat n={sent} label="invites sent" />
          <Stat n={joined} label="joined" />
          <Stat n={listed} label="listed & verified" />
        </div>

        <div className="mt-2">
          <div className="progress" aria-hidden>
            <span style={{ width: `${(progress / goal) * 100}%` }} />
          </div>
          <div className="small muted mt-1">
            {unlocked
              ? "★ Founding Artist unlocked — thank you for building the scene."
              : `${goal - listed} more verified invite${goal - listed === 1 ? "" : "s"} to unlock the Founding Artist badge.`}
          </div>
        </div>
      </div>

      <div className="card mt-3">
        <b>How it works</b>
        <ol className="small muted" style={{ marginLeft: 18, marginTop: 8, lineHeight: 1.9 }}>
          <li>Share your link with acts you know — street performers, café regulars, college bands.</li>
          <li>They join in a minute and list their act (a photo, a clip, a phone number is enough).</li>
          <li>Once verified, they're live for your city — and you move toward the badge.</li>
        </ol>
      </div>

      {invites.length > 0 && (
        <div className="card mt-3">
          <b>Your invites</b>
          <div className="mt-1">
            {invites.map((inv, i) => (
              <div key={i} className="row between" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <span className="small">{inv.name || "Pending"}</span>
                <span className={`tag ${inv.status === "listed" ? "tag-live" : ""}`}>
                  {inv.status === "listed" ? "Listed" : inv.status === "joined" ? "Joined" : "Sent"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="note note-info mt-3">
        Running a venue or planning an event? <Link to="/venues">Post a brief →</Link> and get a
        shortlist including your friends' acts.
      </div>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--marigold)" }}>{n}</div>
      <div className="tiny muted">{label}</div>
    </div>
  );
}
