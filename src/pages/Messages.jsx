import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Avatar, Empty } from "../ui.jsx";

const timeAgo = (ts) => {
  if (!ts) return "";
  const s = Math.max(1, (Date.now() - new Date(ts + (ts.includes("Z") ? "" : "Z")).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ------------------------------------------------------------- inbox ------

function Inbox() {
  const { session } = useSession();
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api("/api/deck/matches");
      setMatches(res.matches || []);
      setError("");
    } catch (e) {
      if (e.status !== 401) setError(e.message);
      setMatches([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (matches === null) {
    return <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}</div>;
  }
  if (!matches.length) {
    return (
      <Empty icon="💫" title="No matches yet">
        Quick match takes two swipes to click. Head to the deck and start the conversation.
        <div className="mt-2"><Link to="/match" className="btn btn-primary btn-sm">Open the deck</Link></div>
      </Empty>
    );
  }
  return (
    <div className="thread-list">
      {matches.map((m) => (
        <Link key={m.id} to={`/messages/${m.thread_id}`} className={`thread-row ${m.unread ? "unread" : ""}`}>
          <Avatar name={m.other.stage_name || m.other.name} hue={m.other.hue} size="avatar-lg" />
          <div className="grow">
            <div className="row between">
              <b>{m.other.stage_name || m.other.name}</b>
              <span className="tiny muted">{timeAgo(m.last_message?.created_at || m.last_message_at)}</span>
            </div>
            <div className="small muted truncate">
              {m.last_message
                ? (m.last_message.sender_id === session?.user?.id ? "You: " : "") + m.last_message.body
                : m.i_am === "host" ? "Matched — say hi first" : "Matched — they swiped you back"}
            </div>
          </div>
          {m.unread > 0 && <span className="unread-pill">{m.unread}</span>}
        </Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- thread -----

function Thread() {
  const { id } = useParams();
  const { session, notify } = useSession();
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const cursorRef = useRef(0);

  const poll = useCallback(async (showErrors = false) => {
    try {
      const res = await api(`/api/deck/threads/${id}?after=${cursorRef.current}`);
      if (res.thread && !thread) setThread(res.thread);
      if (res.messages?.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.seq));
          return [...prev, ...res.messages.filter((m) => !seen.has(m.seq))];
        });
        cursorRef.current = res.cursor;
        setCursor(res.cursor);
      }
      api(`/api/deck/threads/${id}/read`, { method: "POST", body: "{}" }).catch(() => null);
    } catch (e) {
      if (showErrors && e.status !== 401) notify(e.message, "err");
    }
  }, [id, thread, notify]);

  useEffect(() => {
    cursorRef.current = 0;
    setMessages([]);
    setThread(null);
    poll(true);
    const t = setInterval(() => poll(false), 12000);
    return () => clearInterval(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api(`/api/deck/threads/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.seq === res.message.seq) ? prev : [...prev, res.message]));
        cursorRef.current = Math.max(cursorRef.current, Number(res.message.seq || 0));
      }
      setDraft("");
    } catch (err) {
      notify(err.message, "err");
    }
    setSending(false);
  };

  if (!thread && !messages.length) {
    return <div className="skeleton" style={{ height: 320 }} />;
  }

  const other = thread?.other || {};

  return (
    <div className="chat">
      <div className="chat-head">
        <Avatar name={other.name} hue={other.hue} />
        <div className="grow">
          <b>{other.stage_name || other.name}</b>
          <div className="tiny muted">
            {other.category ? `${other.category} · ` : ""}
            {other.response_mins ? `replies in ~${other.response_mins < 60 ? other.response_mins + "m" : "1h"}` : "on Mehfil"}
          </div>
        </div>
        {other.profile_link && <Link className="btn btn-ghost btn-sm" to={other.profile_link}>Profile</Link>}
        <Link className="btn btn-ghost btn-sm" to="/messages">Inbox</Link>
      </div>

      <div className="chat-log">
        <div className="chat-day">Matched — introduce yourself, confirm the date, take it offline.</div>
        {messages.map((m) => {
          const mine = !!session?.user?.id && m.sender_id === session.user.id;
          return (
            <div key={m.seq || m.id} className={`bubble ${mine ? "mine" : ""}`}>
              {m.body}
              <span className="tiny">{timeAgo(m.created_at)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={send}>
        <input
          className="input"
          placeholder="Write a message…"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn btn-primary" disabled={sending || !draft.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </form>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>
        Messages refresh every few seconds. Keep contact and payments on-platform until the gig is confirmed.
      </p>
    </div>
  );
}

export default function Messages() {
  const { id } = useParams();
  return (
    <div className="wrap section" style={{ maxWidth: 860 }}>
      <div className="section-head">
        <div>
          <div className="kicker">Conversations</div>
          <h2>{id ? "Chat" : "Your matches"}</h2>
        </div>
        <Link to="/match" className="btn btn-ghost btn-sm">← Back to deck</Link>
      </div>
      {id ? <Thread /> : <Inbox />}
    </div>
  );
}
