import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function money(n, currency) {
  return `${currency || 'USD'} ${Number(n || 0).toFixed(2)}`;
}

function fmt(d) {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [business, setBusiness] = useState(null);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [d, b] = await Promise.all([api('/api/dashboard/stats'), api('/api/business')]);
      setData(d);
      setBusiness(b.business);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (err) return <div className="alert error">{err}</div>;
  if (!data) return <div className="boot">Loading…</div>;

  const s = data.stats;
  const setup = [
    { done: data.bot.whatsappStatus === 'connected', label: 'Connect WhatsApp', to: '/connect' },
    { done: data.stats.catalogCount > 0, label: 'Add products to catalog', to: '/catalog' },
    { done: !!business?.ownerNumber, label: 'Set your owner number for orders', to: '/settings' },
  ];

  const maxRev = Math.max(1, ...data.daily.map((d) => d.revenue));
  const statusColor =
    data.bot.whatsappStatus === 'connected' ? 'ok' : data.bot.whatsappStatus === 'never' ? 'muted' : 'warn';

  const toggle = async () => {
    await api('/api/business/session', { method: 'POST', body: { active: !data.bot.active } });
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            Store is <span className={`status-dot ${data.bot.active ? 'on' : 'off'}`} /> {data.bot.active ? 'OPEN' : 'CLOSED'} · WhatsApp {data.bot.whatsappStatus}
          </p>
        </div>
        <button className={`btn ${data.bot.active ? 'ghost-danger' : 'success'}`} onClick={toggle}>
          {data.bot.active ? '⏸ Pause store' : '▶ Open store'}
        </button>
      </div>

      <div className="setup-strip">
        {setup.map((st, i) => (
          <React.Fragment key={st.label}>
            {i > 0 && <span className="setup-arrow">→</span>}
            <Link to={st.to} className={`setup-step ${st.done ? 'done' : ''}`}>
              <span className="setup-check">{st.done ? '✓' : i + 1}</span> {st.label}
            </Link>
          </React.Fragment>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Revenue</div>
          <div className="stat-value">{money(s.totalRevenue, s.currency)}</div>
          <div className="stat-sub">all time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Orders</div>
          <div className="stat-value">{s.totalOrders}</div>
          <div className="stat-sub">total placed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Conversations</div>
          <div className="stat-value">{s.totalConversations}</div>
          <div className="stat-sub">customers chatted</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Products</div>
          <div className="stat-value">{s.catalogCount}</div>
          <div className="stat-sub">in catalog</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Sales — last 14 days</h2>
          <div className="chart">
            {data.daily.map((d) => (
              <div className="chart-col" key={d._id} title={`${d._id}: ${money(d.revenue, s.currency)} (${d.orders} orders)`}>
                <div className="chart-bar" style={{ height: `${Math.max(4, (d.revenue / maxRev) * 100)}%` }} />
                <div className="chart-label">{new Date(d._id + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
              </div>
            ))}
            {data.daily.length === 0 && <p className="muted">No sales yet. Share your WhatsApp number and start chatting!</p>}
          </div>
        </div>

        <div className="panel">
          <h2>Top products</h2>
          {data.topProducts.length === 0 && <p className="muted">No product sales yet.</p>}
          {data.topProducts.map((p, i) => (
            <div className="top-item" key={p._id}>
              <span className="rank">{i + 1}</span>
              <div className="top-body">
                <div className="top-name">{p._id}</div>
                <div className="top-meta">
                  {p.qty} sold · {money(p.revenue, s.currency)}
                </div>
              </div>
              <div className="top-bar" style={{ width: `${Math.min(100, (p.revenue / (data.topProducts[0]?.revenue || 1)) * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Recent orders</h2>
        {data.recentOrders.length === 0 && <p className="muted">No orders yet — share your WhatsApp and let the AI sell for you.</p>}
        {data.recentOrders.map((o) => (
          <div className="order-row" key={o._id}>
            <div>
              <strong>+{o.customer.number}</strong> <span className="muted">· {fmt(o.createdAt)}</span>
            </div>
            <div className="muted">{o.items.map((i) => `${i.title}×${i.qty}`).join(', ')}</div>
            <div>
              <strong>{money(o.total, o.currency)}</strong>
              <span className={`chip-status ${o.status}`}>{o.status}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel info-panel">
        <h2>How it works</h2>
        <ol>
          <li>Connect your WhatsApp number (scan QR or enter pairing PIN).</li>
          <li>Add your products to the catalog — the bot will send them as links.</li>
          <li>Customers message you; the AI answers, recommends, and closes the sale.</li>
          <li>Orders notify you on WhatsApp instantly, and appear here.</li>
          <li>If the AI gets stuck, it hands the customer over to you automatically.</li>
        </ol>
      </div>
    </div>
  );
}
