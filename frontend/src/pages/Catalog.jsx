import React, { useEffect, useState } from 'react';
import { api } from '../api';

const empty = { title: '', price: '', description: '', imageUrl: '' };

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulking, setBulking] = useState(false);

  const load = async () => {
    try {
      const d = await api('/api/catalog');
      setItems(d.items);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    try {
      if (editing) {
        await api(`/api/catalog/${editing}`, { method: 'PUT', body: { ...form, price: parseFloat(form.price) } });
      } else {
        await api('/api/catalog', { method: 'POST', body: { ...form, price: parseFloat(form.price) } });
      }
      setForm(empty);
      setEditing(null);
      setOk('Saved!');
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this product?')) return;
    await api(`/api/catalog/${id}`, { method: 'DELETE' });
    load();
  };

  const edit = (item) => {
    setEditing(item._id);
    setForm({ title: item.title, price: item.price, description: item.description, imageUrl: item.imageUrl });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const sync = async () => {
    setErr('');
    setOk('');
    setSyncing(true);
    try {
      const d = await api('/api/catalog/sync', { method: 'POST', body: {} });
      if (d.imported || d.updated) {
        setOk(
          d.source === 'messages'
            ? `Imported products you shared in WhatsApp chats: ${d.imported} added, ${d.updated} updated.`
            : `Synced from your WhatsApp catalog: ${d.imported} added, ${d.updated} updated.`
        );
      } else {
        setOk('Your WhatsApp catalog is already in sync.');
      }
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSyncing(false);
    }
  };

  const bulkSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    setBulking(true);
    try {
      const d = await api('/api/catalog/bulk', { method: 'POST', body: { text: bulkText } });
      setOk(`Added ${d.imported} product${d.imported === 1 ? '' : 's'}.`);
      setBulkOpen(false);
      setBulkText('');
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBulking(false);
    }
  };

  const bulkCount = bulkText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <p className="muted">Products the AI will show customers as links. Add everything you sell.</p>
        </div>
        <div className="btn-group">
          <button className="btn" onClick={sync} disabled={syncing} title="Import the products already saved in your WhatsApp Business catalog">
            {syncing ? 'Syncing…' : 'Sync from WhatsApp Catalog'}
          </button>
          <button className="btn" onClick={() => setBulkOpen(true)} title="Paste a list of products instead of adding them one by one">
            Paste products
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="modal-backdrop" onClick={() => setBulkOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={bulkSubmit}>
            <h2>Paste products</h2>
            <p className="muted">
              One product per line: <code>Name | Price | Description (optional)</code>. Re-importing the same name updates it.
            </p>
            <textarea
              rows={10}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Chicken Burger | 450\nFries | 250 | Crispy salted fries\nCold Drink | 150'}
              autoFocus
            />
            <div className="btn-group" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <span className="muted">{bulkCount} line{bulkCount === 1 ? '' : 's'}</span>
              <div>
                <button type="button" className="btn" onClick={() => setBulkOpen(false)}>
                  Cancel
                </button>
                <button className="btn primary" type="submit" disabled={bulking || !bulkCount}>
                  {bulking ? 'Adding…' : 'Add all'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {err && <div className="alert error">{err}</div>}
      {ok && <div className="alert success">{ok}</div>}

      <div className="grid-catalog">
        <form className="panel form-panel" onSubmit={submit}>
          <h2>{editing ? 'Edit product' : 'Add a product'}</h2>
          <label>Product name</label>
          <input value={form.title} onChange={set('title')} placeholder="e.g. Chocolate Croissant" required />
          <label>Price</label>
          <input value={form.price} onChange={set('price')} type="number" step="0.01" min="0" placeholder="4.50" required />
          <label>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={3} placeholder="What makes it great? The AI uses this to sell it." />
          <label>Image URL (optional)</label>
          <input value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…/photo.jpg" />
          <div className="btn-group">
            <button className="btn primary" type="submit">
              {editing ? 'Save changes' : 'Add product'}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={() => { setEditing(null); setForm(empty); }}>
                Cancel
              </button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Each product gets a shareable page: <code>/p/&lt;slug&gt;</code> — the bot sends this link to customers.
          </p>
        </form>

        <div className="panel">
          <h2>{items.length} product{items.length === 1 ? '' : 's'}</h2>
          {items.length === 0 && <p className="muted">No products yet. Add your first product on the left.</p>}
          {items.map((it) => (
            <div className="catalog-item" key={it._id}>
              {it.imageUrl && <img src={it.imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <div className="ci-body">
                <div className="ci-title">
                  {it.title} <span className="muted">· /p/{it.slug}</span>
                </div>
                <div className="ci-price">
                  {it.currency || ''} {Number(it.price).toFixed(2)}
                </div>
              </div>
              <div className="ci-actions">
                <button className="link-btn" onClick={() => edit(it)}>
                  Edit
                </button>
                <button className="link-btn danger" onClick={() => remove(it._id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
