import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Share() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/business/share')
      .then(setInfo)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="alert error">{err}</div>;
  if (!info) return <div className="boot">Loading…</div>;

  const copy = (text) => navigator.clipboard.writeText(text);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Share your store</h1>
          <p className="muted">
            Your WhatsApp number, QR code and store page — everything customers need to reach you.
          </p>
        </div>
      </div>

      <div className="share-grid">
        <div className="panel">
          <h2>Your business card</h2>
          {!info.whatsappNumber && (
            <div className="alert warn">Connect WhatsApp first to get your shareable number and QR code.</div>
          )}
          <div className="share-card">
            <div className="share-name">{info.name}</div>
            <div className="muted">{info.tagline}</div>
            {info.whatsappNumber && <div className="share-phone">+{info.whatsappNumber}</div>}
            {info.qr && <img className="qr-img" src={info.qr} alt="WhatsApp QR" />}
          </div>

          <div className="btn-group">
            {info.waLink && (
              <a className="btn primary" href={info.waLink} target="_blank" rel="noreferrer">
                Open wa.me link
              </a>
            )}
            {info.whatsappNumber && (
              <button className="btn" onClick={() => copy(`+${info.whatsappNumber}`)}>
                Copy number
              </button>
            )}
            {info.qr && (
              <button className="btn" onClick={() => copy(info.qr)}>
                Copy QR
              </button>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Public store page</h2>
          <p className="muted">A single link customers can open to see your info, scan your QR and browse products.</p>
          <div className="share-card">
            <a href={info.publicPage} target="_blank" rel="noreferrer">
              {info.publicPage}
            </a>
          </div>
          <button className="btn" onClick={() => copy(info.publicPage)}>
            Copy link
          </button>

          <h2 style={{ marginTop: 24 }}>Product links</h2>
          <p className="muted">The AI sends product page links automatically. Add products in the Catalog tab.</p>
        </div>
      </div>
    </div>
  );
}
