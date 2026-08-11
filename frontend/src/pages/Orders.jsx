import React, { useEffect, useState } from 'react';
import { api } from '../api';

const STATUSES = ['new', 'confirmed', 'completed', 'cancelled'];

function fmt(d) {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const d = await api('/api/orders');
      setOrders(d.orders);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id, status) => {
    await api(`/api/orders/${id}/status`, { method: 'PUT', body: { status } });
    load();
  };

  const revenue = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  const currency = orders[0]?.currency || 'USD';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">
            {orders.length} orders · total revenue {currency} {revenue.toFixed(2)}
          </p>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {orders.length === 0 && (
        <div className="panel">
          <p className="muted">No orders yet. When a customer buys through WhatsApp, the order appears here and on your phone.</p>
        </div>
      )}
      <div className="panel">
        {orders.map((o) => (
          <div className="order-row" key={o._id}>
            <div className="order-main">
              <strong>+{o.customer.number}</strong>
              {o.customer.name && <span className="muted"> · {o.customer.name}</span>}
              <div className="muted small">
                {fmt(o.createdAt)}
                {o.note ? ` · ${o.note}` : ''}
              </div>
            </div>
            <div className="order-items muted">{o.items.map((i) => `${i.title} ×${i.qty}`).join(', ')}</div>
            <div className="order-total">
              <strong>
                {o.currency} {o.total.toFixed(2)}
              </strong>
            </div>
            <select value={o.status} className="chip-status" onChange={(e) => setStatus(o._id, e.target.value)}>
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
