import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { SignOutButton, useFreebuffUser } from "@freebuff/auth/react";
import { useSession } from "./session.jsx";
import { Avatar, SignInLink, CATS } from "./ui.jsx";
import Landing from "./pages/Landing.jsx";

// Every non-landing route is split into its own chunk: the first paint ships
// the homepage, not the engine console, match deck and booking flow.
const Discover = lazy(() => import("./pages/Discover.jsx"));
const ArtistProfile = lazy(() => import("./pages/ArtistProfile.jsx"));
const BookFlow = lazy(() => import("./pages/BookFlow.jsx"));
const Bookings = lazy(() => import("./pages/Bookings.jsx"));
const BookingDetail = lazy(() => import("./pages/BookingDetail.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Collab = lazy(() => import("./pages/Collab.jsx"));
const Shows = lazy(() => import("./pages/Shows.jsx"));
const Jams = lazy(() => import("./pages/Jams.jsx"));
const JamDetail = lazy(() => import("./pages/JamDetail.jsx"));
const Join = lazy(() => import("./pages/Join.jsx"));
const Leads = lazy(() => import("./pages/Leads.jsx"));
const Claim = lazy(() => import("./pages/Claim.jsx"));
const Need = lazy(() => import("./pages/Need.jsx"));
const RequestStatus = lazy(() => import("./pages/Need.jsx").then((m) => ({ default: m.RequestStatus })));
const Respond = lazy(() => import("./pages/Respond.jsx"));
const TalentProfile = lazy(() => import("./pages/TalentProfile.jsx"));
const Engines = lazy(() => import("./pages/Engines.jsx"));
const Match = lazy(() => import("./pages/Match.jsx"));
const Messages = lazy(() => import("./pages/Messages.jsx"));
const Venues = lazy(() => import("./pages/Venues.jsx"));
const Invite = lazy(() => import("./pages/Invite.jsx"));

// Icon set for the mobile tab bar — stroke SVGs rather than emoji so the bar
// stays crisp and visually quiet inside a frosted surface.
function TabIcon({ name }) {
  const paths = {
    home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.2 16.2 21 21",
    bolt: "M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z",
    pen: "M4 20h4L20 8l-4-4L4 16zM14 6l4 4",
    store: "M4 9h16v11H4zM3 9l2-5h14l2 5M9 20v-6h6v6",
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    paint();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <span className="nav-progress" ref={ref} aria-hidden="true" />;
}

function Nav() {
  const { session } = useSession();
  const { user } = useFreebuffUser();
  const name = session?.user?.name || user?.name;
  const signedIn = !!session?.user;
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever the route changes (link tap, back/forward).
  useEffect(() => { setMenu(false); }, [pathname]);

  // Condense the header once the page moves; a boolean flip avoids re-rendering
  // the nav on every scroll frame.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = window.scrollY > 10;
      setScrolled((prev) => (prev === next ? prev : next));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    window.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

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
    <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
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
            <>
              <NavLink to="/list-your-act" className="btn btn-ghost btn-sm nav-join">
                List your act
              </NavLink>
              <SignInLink returnTo={window.location.pathname} className="btn btn-sm">
                Sign in
              </SignInLink>
            </>
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
      <ScrollProgress />
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

function TabBar() {
  const items = [
    ["/", "Home", "home", true],
    ["/discover", "Discover", "search", false],
    ["/match", "Match", "bolt", false],
    ["/need", "Need", "pen", false],
    ["/venues", "Venues", "store", false],
  ];
  return (
    <nav className="tabbar" aria-label="Primary">
      {items.map(([to, label, icon, end]) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
        >
          <TabIcon name={icon} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
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

// Route-level suspense fallback: a quiet skeleton, no spinner flash.
// One bad chunk or render should never blank the whole app: keep the frame,
// explain, and offer a reload.
class RouteBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap section center" style={{ maxWidth: 520 }}>
        <h2>That page didn't load</h2>
        <p className="muted">A network blip can interrupt a route. Nothing you saved is affected.</p>
        <button
          className="btn btn-primary"
          onClick={() => { this.setState({ failed: false }); window.location.reload(); }}
        >
          Reload
        </button>
      </div>
    );
  }
}

function RouteFallback() {
  return (
    <div className="wrap section" aria-busy="true">
      <div className="skeleton" style={{ height: 26, width: 190, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 120, marginBottom: 14 }} />
      <div className="grid grid-3">
        {[0, 1, 2].map((i) => (
          <div className="skeleton" key={i} style={{ height: 180 }} />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <RouteBoundary>
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
        </RouteBoundary>
      </main>
      <Footer />
      <TabBar />
    </>
  );
}
