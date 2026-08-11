import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

function fmt(d) {
  const t = new Date(d);
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Inbox() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const bottom = useRef(null);

  const loadConvos = async () => {
    try {
      const d = await api('/api/inbox');
      setConversations(d.conversations);
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadMessages = async (id) => {
    const d = await api(`/api/inbox/${id}/messages`);
    setMessages(d.messages);
    setActive(id);
  };

  useEffect(() => {
    loadConvos();
    const t = setInterval(loadConvos, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) return;
    loadMessages(active);
    const t = setInterval(() => loadMessages(active), 4000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!draft.trim()) return;
    await api(`/api/inbox/${active}/send`, { method: 'POST', body: { text: draft } });
    setDraft('');
    loadMessages(active);
    loadConvos();
  };

  const resolve = async () => {
    await api(`/api/inbox/${active}/resolve`, { method: 'POST' });
    loadConvos();
  };

  const conv = conversations.find((c) => c.id === active);

  return (
    <div className="page inbox-page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">
            Conversations where the AI handed over need your attention. Reply here to take over.
          </p>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}

      <div className="inbox-grid">
        <div className="panel conv-list">
          {conversations.length === 0 && <p className="muted">No conversations yet.</p>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${active === c.id ? 'active' : ''} ${c.handedOver ? 'handed' : ''}`}
              onClick={() => loadMessages(c.id)}
            >
              <div className="conv-head">
                <strong>+{c.number}</strong>
                <span className="muted small">{fmt(c.lastAt)}</span>
              </div>
              <div className="conv-last">{c.lastMessage}</div>
              {c.handedOver && <span className="tag warn">Needs human</span>}
            </div>
          ))}
        </div>

        <div className="panel chat-panel">
          {!active && <div className="chat-empty">Select a conversation to view or reply.</div>}
          {active && (
            <>
              <div className="chat-head">
                <div>
                  <strong>+{active}</strong>
                  {conv?.handedOver && <span className="tag warn">Handed over to human</span>}
                </div>
                <button className="btn small" onClick={resolve}>
                  Resume AI
                </button>
              </div>
              <div className="chat-body">
                {messages
                  .filter((m) => m.from !== 'system')
                  .map((m) => (
                    <div key={m._id} className={`bubble ${m.from}`}>
                      {m.text}
                      <div className="bubble-time">{fmt(m.createdAt)}</div>
                    </div>
                  ))}
                <div ref={bottom} />
              </div>
              <div className="chat-input">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a reply to the customer…"
                />
                <button className="btn primary" onClick={send}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
