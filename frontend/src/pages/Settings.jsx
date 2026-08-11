import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const d = await api('/api/business');
      setForm(d.business);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setSetting = (k) => (e) => setForm({ ...form, settings: { ...form.settings, [k]: e.target.value } });

  const save = async () => {
    setErr('');
    setSaved('');
    try {
      const body = {
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        category: form.category,
        currency: form.currency,
        logoUrl: form.logoUrl,
        website: form.website,
        ownerNumber: form.ownerNumber,
        settings: {
          welcomeMessage: form.settings.welcomeMessage,
          awayMessage: form.settings.awayMessage,
        },
      };
      const d = await api('/api/business', { method: 'PUT', body });
      setForm(d.business);
      setSaved('Settings saved!');
    } catch (e2) {
      setErr(e2.message);
    }
  };

  if (!form) return <div className="boot">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Business info, owner number and bot behavior.</p>
        </div>
        <button className="btn primary" onClick={save}>
          Save changes
        </button>
      </div>
      {err && <div className="alert error">{err}</div>}
      {saved && <div className="alert success">{saved}</div>}

      <div className="settings-grid">
        <div className="panel">
          <h2>Business profile</h2>
          <label>Business name</label>
          <input value={form.name} onChange={set('name')} />
          <label>Tagline</label>
          <input value={form.tagline} onChange={set('tagline')} placeholder="e.g. Fresh bakery in town" />
          <label>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={3} />
          <label>Category</label>
          <input value={form.category} onChange={set('category')} placeholder="e.g. Bakery, Fashion, Electronics" />
          <label>Currency</label>
          <input value={form.currency} onChange={set('currency')} placeholder="USD" />
          <label>Website</label>
          <input value={form.website} onChange={set('website')} placeholder="https://" />
        </div>

        <div className="panel">
          <h2>Owner & notifications</h2>
          <p className="muted small">
            The owner number receives order alerts and customer handovers on WhatsApp. International format, digits only.
          </p>
          <label>Owner WhatsApp number</label>
          <input value={form.ownerNumber} onChange={set('ownerNumber')} placeholder="e.g. 14155552671" />

          <h2 style={{ marginTop: 24 }}>Bot messages</h2>
          <label>Welcome message (optional)</label>
          <textarea value={form.settings.welcomeMessage} onChange={setSetting('welcomeMessage')} rows={2} placeholder="Leave empty for AI-generated greeting" />
          <label>Away message (when store is paused)</label>
          <textarea value={form.settings.awayMessage} onChange={setSetting('awayMessage')} rows={2} />

          <div className="toggle-row">
            <div>
              <strong>Auto-reply</strong>
              <div className="muted small">Turn off to stop the AI from responding automatically.</div>
            </div>
            <input
              type="checkbox"
              checked={form.settings.autoReply}
              onChange={(e) => setForm({ ...form, settings: { ...form.settings, autoReply: e.target.checked } })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
