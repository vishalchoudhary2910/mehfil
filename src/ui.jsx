import { Link } from "react-router-dom";
import { signInUrl } from "@freebuff/auth/react";
import { CATEGORIES, CATEGORY_KEYS, categoryLabel, categoryIcon } from "../shared/categories.js";

export const INR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Single source of truth lives in shared/categories.js so the radar engine,
// matching and every picker use the same taxonomy (poets included).
export const CATS = CATEGORIES;
export { CATEGORY_KEYS, categoryLabel, categoryIcon };

export const catOptions = (includeOther = true) =>
  CATEGORY_KEYS.filter((k) => includeOther || k !== "other").map((k) => ({ key: k, ...CATEGORIES[k] }));

export const hueStyle = (hue, deg = 135) => ({
  background: `linear-gradient(${deg}deg, hsl(${hue}, 62%, 46%), hsl(${(hue + 52) % 360}, 72%, 56%))`,
});

export const initials = (name) =>
  String(name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function Avatar({ name, hue = 265, size = "" }) {
  return (
    <span className={`avatar ${size}`} style={hueStyle(hue)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Stars({ value = 0, count }) {
  const full = Math.round(Number(value));
  return (
    <span className="stars" title={`${value} / 5`}>
      {"★".repeat(full)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - full)}</span>
      {count != null && (
        <span className="small muted" style={{ letterSpacing: 0, marginLeft: 5 }}>
          {Number(value).toFixed(1)} ({count})
        </span>
      )}
    </span>
  );
}

export function StatusPill({ status, escrow }) {
  const map = {
    pending: ["pending", "Awaiting artist"],
    confirmed: ["confirmed", "Confirmed"],
    completed: ["completed", "Completed"],
    cancelled: ["cancelled", "Cancelled"],
    disputed: ["disputed", "Disputed"],
  };
  const [cls, label] = map[status] || [status, status];
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`status status-${cls}`}>{label}</span>
      {escrow && escrow !== "none" && (
        <span className={`status status-${escrow}`}>escrow: {escrow}</span>
      )}
    </span>
  );
}

export function Badge({ kind }) {
  if (kind === "verified") return <span className="badge badge-verified">✓ Verified</span>;
  if (kind === "founding") return <span className="badge badge-found">★ Founding Artist</span>;
  if (kind === "new") return <span className="badge badge-new">New</span>;
  return null;
}

export function SourceBadge({ source }) {
  const map = {
    musicbrainz: "MusicBrainz",
    youtube: "YouTube",
    events: "Event listing",
    ical: "Venue calendar",
    bandsintown: "Bandsintown",
    eventbrite: "Eventbrite",
    claim: "Self-registered",
    manual: "Added by Mehfil",
    csv: "Imported list",
  };
  return <span className="tag">{map[source] || source || "Directory"}</span>;
}

export function Empty({ icon = "🎵", title, children }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 600, color: "var(--text-2)" }}>{title}</div>
      {children && <div className="small mt-1">{children}</div>}
    </div>
  );
}

export function SignInLink({ returnTo, className = "btn btn-primary", children }) {
  return (
    <a className={className} href={signInUrl(returnTo || window.location.pathname)}>
      {children || "Sign in with Freebuff"}
    </a>
  );
}

// Small helper for internal links that preserve query strings.
export const qs = (params) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== "" && v != null && u.set(k, v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export { Link };
