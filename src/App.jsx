import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { SignOutButton, useFreebuffUser } from "@freebuff/auth/react";
import { useSession } from "./session.jsx";
import { Avatar, SignInLink, CATS } from "./ui.jsx";
import Landing from "./pages/Landing.jsx";
import Discover from "./pages/Discover.jsx";
import ArtistProfile from "./pages/ArtistProfile.jsx";
import BookFlow from "./pages/BookFlow.jsx";
import Bookings from "./pages/Bookings.jsx";
import BookingDetail from "./pages/BookingDetail.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Collab from "./pages/Collab.jsx";
import Shows from "./pages/Shows.jsx";
import Jams from "./pages/Jams.jsx";
import JamDetail from "./pages/JamDetail.jsx";
import Join from "./pages/Join.jsx";
import Leads from "./pages/Leads.jsx";
import Claim from "./pages/Claim.jsx";
import Need, { RequestStatus } from "./pages/Need.jsx";
import Respond from "./pages/Respond.jsx";
import TalentProfile from "./pages/TalentProfile.jsx";
import Engines from "./pages/Engines.jsx";
import Match from "./pages/Match.jsx";
import Messages from "./pages/Messages.jsx";
import Venues from "./pages/Venues.jsx";
import Invite from "./pages/Invite.jsx";

function Nav() {
  const { session } = useSession();
  const { user } = useFreebuffUser();
  const name = session?.user?.name || user?.name;
  const signedIn = !!session?.user;
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever the route changes (link tap, back/forward).
  useEffect(() => { setMenu(false); }, [pathname]);

  // Four core destinations stay in the bar; the menu carries every page.
  // The strip must fit even with the widest signed-in controls, so it never
  // grows past this set — the drawer is the single source of completeness.
  const primary = [
    ["/discover", "Find talent"],
    ["/match", "Quick match"],
    ["/need", "Need talent"],
    ["/shows", "Shows"],
  ];
  const links = [
    ...primary,
    ["/venues", "For venues"],
    ["/collab", "Collab board"],
    ["/jams", "Jams"],
  ];
  if (session?.artist) links.push(["/dashboard", "Artist desk"]);
  if (signedIn) {
    links.push(["/messages", "Messages"], ["/bookings", "My bookings"], ["/leads", "Leads"], ["/engines", "Engines"]);
  }

  return (
    <header className="nav">
      <div className="wrap">
        <NavLink to="/" className="logo">
          Mehfil <span className="dot" />
        </NavLink>
        <nav className="nav-links">
          {primary.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="right">
          {signedIn ? (
            <>
              <NavLink to="/join" className="btn btn-ghost btn-sm nav-join">
                {session?.artist ? "My profile" : "List as an artist"}
              </NavLink>
              <span className="nav-user">
                <Avatar name={name} hue={session?.artist?.hue || 265} />
                <span className="small">{name}</span>
              </span>
              <SignOutButton className="btn btn-ghost btn-sm" returnTo="/">
                Sign out
              </SignOutButton>
            </>
          ) : (
            <SignInLink returnTo={window.location.pathname} className="btn btn-sm">
              Sign in
            </SignInLink>
          )}
          <button
            className="nav-toggle"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="nav-panel"
            onClick={() => setMenu((v) => !v)}
          >
            <span className="nav-toggle-label">Menu</span>
            <span className="nav-toggle-icon" aria-hidden>{menu ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>
      <div id="nav-panel" className={`nav-panel ${menu ? "open" : ""}`}>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
            {label}
          </NavLink>
        ))}
        <NavLink to="/join" className={({ isActive }) => (isActive ? "active" : "")}>
          {session?.artist ? "My profile" : "List as an artist"}
        </NavLink>
        {signedIn && (
          <SignOutButton className="btn btn-ghost nav-panel-out" returnTo="/">
            Sign out
          </SignOutButton>
        )}
      </div>
    </header>
  );
}

function Footer() {
  const cats = Object.entries(CATS).filter(([k]) => k !== "other");
  const cities = ["Pune", "Mumbai", "Jaipur"];
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <h4>Explore</h4>
            <NavLink to="/discover">Find talent</NavLink>
            <NavLink to="/collab">Collab board</NavLink>
            <NavLink to="/shows">Shows near you</NavLink>
            <NavLink to="/match">Quick-match deck</NavLink>
            <NavLink to="/venues">For venues & occasions</NavLink>
            <NavLink to="/invite">Invite fellow artists</NavLink>
            <NavLink to="/jams">Jam circles</NavLink>
            <NavLink to="/bookings">My bookings</NavLink>
            <NavLink to="/in">City guides</NavLink>
          </div>
          <div>
            <h4>For artists</h4>
            <NavLink to="/join">List your profile</NavLink>
            <NavLink to="/list-your-act">List your act (get leads)</NavLink>
            <NavLink to="/discover?view=directory">Claim your profile</NavLink>
            <NavLink to="/dashboard">Artist desk</NavLink>
            <NavLink to="/engines">Engine room</NavLink>
          </div>
          <div>
            <h4>Popular searches</h4>
            {cats.map(([k, v]) => (
              <NavLink key={k} to={`/discover?category=${k}`}>{v.label} in Pune</NavLink>
            ))}
          </div>
          <div>
            <h4>Cities</h4>
            {cities.map((c) => (
              <NavLink key={c} to={`/discover?city=${c}`}>Artists in {c}</NavLink>
            ))}
          </div>
        </div>
        <div className="fine">
          Mehfil — hire, team up, and perform. Escrow-style payments, verified profiles and
          two-way reviews for private events in India. Demo build: payments, KYC and payouts are
          simulated end-to-end; no real money moves.
        </div>
      </div>
    </footer>
  );
}

// Sign-in gate for app pages that need an account.
function RequireAuth({ children }) {
  const { session } = useSession();
  const loc = useLocation();
  if (session === undefined) return <div className="wrap section"><div className="skeleton" style={{ height: 120 }} /></div>;
  if (session === null) {
    return (
      <div className="wrap section center" style={{ maxWidth: 520 }}>
        <h2>Sign in to continue</h2>
        <p className="muted">Mehfil accounts are shared for booking and artist tools — one account, host or artist.</p>
        <SignInLink returnTo={loc.pathname}>Sign in with Freebuff</SignInLink>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/artist/:slug" element={<ArtistProfile />} />
          <Route path="/book/:packageId" element={<RequireAuth><BookFlow /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
          <Route path="/bookings/:id" element={<RequireAuth><BookingDetail /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/collab" element={<Collab />} />
          <Route path="/shows" element={<Shows />} />
          <Route path="/jams" element={<Jams />} />
          <Route path="/jam/:token" element={<JamDetail />} />
          <Route path="/join" element={<RequireAuth><Join /></RequireAuth>} />
          <Route path="/leads" element={<RequireAuth><Leads /></RequireAuth>} />
          <Route path="/engines" element={<RequireAuth><Engines /></RequireAuth>} />
          <Route path="/list-your-act" element={<Claim />} />
          <Route path="/need" element={<Need />} />
          <Route path="/request/:token" element={<RequestStatus />} />
          <Route path="/respond/:token" element={<Respond />} />
          <Route path="/talent/:slug" element={<TalentProfile />} />
          <Route path="/match" element={<RequireAuth><Match /></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="/messages/:id" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="/venues" element={<Venues />} />
          <Route path="/invite" element={<Invite />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
