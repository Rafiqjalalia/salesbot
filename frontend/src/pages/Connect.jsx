import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const STATUS_LABELS = {
  never: 'Not connected yet',
  connecting: 'Starting browser…',
  qr: 'Scan the QR code with WhatsApp',
  pairing: 'Waiting for the PIN to be confirmed',
  authenticated: 'Syncing messages (takes up to 5 mins)…',
  connected: 'Connected ✓',
  failed: 'Connection failed',
  disconnected: 'Disconnected',
};

export default function Connect() {
  const [status, setStatus] = useState({ status: 'never', qr: null, pairingCode: null, error: '' });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const poll = useRef(null);

  const load = async () => {
    try {
      const st = await api('/api/business/connect/status');
      setStatus(st);
      if (st.pairingCode) setPin(st.pairingCode);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
    poll.current = setInterval(load, 2000);
    return () => clearInterval(poll.current);
  }, []);

  const startConnect = async () => {
    setErr('');
    setMsg('');
    await api('/api/business/connect', { method: 'POST' });
    load();
  };

  const getPin = async () => {
    setErr('');
    setPinBusy(true);
    try {
      const d = await api('/api/business/connect/pin', { method: 'POST', body: { phone } });
      setPin(d.pairingCode);
      setMsg('Open WhatsApp → Settings → Linked devices → Link a device → pair with a phone number instead, then enter the code below. It expires after a few minutes.');
    } catch (e) {
      setErr(e.message);
      if (e.message.includes('pairing code')) {
        setMsg('Pairing code could not be generated on this connection. Please use the QR code instead — scan it with WhatsApp → Linked devices.');
      }
    } finally {
      setPinBusy(false);
    }
  };

  const disconnect = async () => {
    await api('/api/business/disconnect', { method: 'POST' });
    setPin('');
    setStatus({ status: 'disconnected', qr: null, pairingCode: null, error: '' });
    setMsg('Saved WhatsApp session cleared. If the phone just refused to link, wait 5–10 minutes before starting a fresh connection — WhatsApp temporarily blocks too many link attempts.');
  };

  const polling = ['connecting', 'qr', 'pairing', 'authenticated'].includes(status.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Connect WhatsApp</h1>
          <p className="muted">Link your business number — this runs the AI bot 24/7.</p>
        </div>
        {status.status === 'connected' ? (
          <button className="btn ghost-danger" onClick={disconnect}>
            Disconnect
          </button>
        ) : polling || status.status === 'connecting' ? (
          <button
            className="btn ghost-danger"
            onClick={disconnect}
            title="Clears the saved session so you can start over with a fresh QR"
          >
            Reset connection
          </button>
        ) : (
          !polling && status.status !== 'connecting' && (
            <button className="btn primary" onClick={startConnect}>
              {status.status === 'never' || status.status === 'disconnected' || status.status === 'failed' ? 'Start connection' : 'Retry'}
            </button>
          )
        )}
      </div>

      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}

      <div className="connect-grid">
        <div className={`panel connect-panel ${status.status === 'connected' ? 'connected' : ''}`}>
          <div className="conn-status">
            <span className={`status-pill ${status.status}`}>{STATUS_LABELS[status.status] || status.status}</span>
          </div>

          {status.status === 'connected' && (
            <div className="connected-box">
              <div className="big-check">✓</div>
              <h2>Your AI bot is live!</h2>
              <p className="muted">
                Customers can now message you. The AI will respond, show products, take orders and notify you.
              </p>
              <div className="btn-group">
                <a className="btn primary" href="/catalog">
                  Add products →
                </a>
                <a className="btn" href="/settings">
                  Set owner number
                </a>
              </div>
            </div>
          )}

          {polling && (
            <div className="qr-area">
              <h2>Step 1 — Scan the QR code</h2>
              <p className="muted">Open WhatsApp on your phone → Menu → Linked devices → Link a device.</p>
              {status.qr ? (
                <img className="qr-img" src={status.qr} alt="WhatsApp QR code" />
              ) : (
                <div className="qr-loading">Preparing QR code…</div>
              )}

              <div className="or-divider">
                <span>or</span>
              </div>

              <h2>Step 2 — Pair with a PIN</h2>
              <p className="muted">
                Don't want to scan? Enter your number (country code + number, digits only) and we'll generate a pairing code. This replaces the QR above.
              </p>
              <div className="row">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 14155552671" disabled={pinBusy} />
                <button className="btn primary" onClick={getPin} disabled={!phone || pinBusy}>
                  {pinBusy ? 'Requesting PIN…' : 'Get PIN'}
                </button>
              </div>
              {pin && (
                <div className="pin-box">
                  <div className="pin-label">Enter this code in WhatsApp on your phone:</div>
                  <div className="pin-code">{pin}</div>
                  {status.status === 'pairing' && (
                    <button className="btn small" style={{ marginTop: 12 }} onClick={startConnect}>
                      Prefer scanning? Switch to QR →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {status.status === 'authenticated' && (
             <div className="idle-box">
                <div className="big-icon">⏳</div>
                <h2>Syncing your messages</h2>
                <p className="muted">
                  Your device was successfully linked! WhatsApp is now securely downloading your recent chat history to the server.
                </p>
                <ul className="tips">
                  <li>This process usually takes 2 to 5 minutes.</li>
                  <li>Please leave this page open and wait. Do not disconnect.</li>
                  <li>Once it finishes, this page will automatically update to Connected.</li>
                </ul>
             </div>
          )}

          {!polling && status.status !== 'connected' && (
            <div className="idle-box">
              <div className="big-icon">🔗</div>
              <h2>Link your WhatsApp number</h2>
              <p className="muted">
                Click <strong>Start connection</strong> to open a secure browser session, then scan the QR code with
                WhatsApp. Prefer typing? Get a pairing PIN instead.
              </p>
              <ul className="tips">
                <li>Use a dedicated number for the bot (e.g. a second SIM or WhatsApp Business number).</li>
                <li>Keep this browser open while connecting.</li>
                <li>Your session is saved securely so you won't need to re-scan often.</li>
              </ul>
            </div>
          )}

          {status.status === 'failed' && status.error && <div className="alert error">{status.error}</div>}
          {status.status === 'failed' && (
            <div className="idle-box">
              <div className="big-icon">📵</div>
              <h2>Linking was refused</h2>
              <p className="muted">
                If your phone said it <strong>couldn't link the device</strong>, WhatsApp is usually blocking the
                attempt, not your code.
              </p>
              <ul className="tips">
                <li>Wait 5–10 minutes before retrying — WhatsApp temporarily blocks too-quick link attempts.</li>
                <li>Click <strong>Reset connection</strong> first to clear the old half-saved session, then Start connection for a fresh QR.</li>
                <li>Scan the QR with WhatsApp → <strong>Linked devices</strong> → <strong>Link a device</strong>.</li>
                <li>If it still refuses, try the <strong>Get PIN</strong> option above, or wait a few hours and try again.</li>
              </ul>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Security notes</h2>
          <ul className="tips">
            <li>You can connect or disconnect anytime.</li>
            <li>WhatsApp requires a phone number; the bot runs like a linked device.</li>
            <li>Use it responsibly — spam can get numbers blocked.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
