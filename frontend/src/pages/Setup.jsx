import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Setup() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    try {
      setData(await api('/api/setup/status'));
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (err) return <div className="alert error">{err}</div>;
  if (!data) return <div className="boot">Loading…</div>;

  const { steps, doneCount, total } = data;
  const pct = Math.round((doneCount / total) * 100);
  const current = steps.find((s) => !s.done);
  const allDone = !current;
  const b = data.business;

  const connectLabel =
    b.whatsappStatus === 'connecting'
      ? 'Connecting…'
      : b.whatsappStatus === 'qr'
      ? 'Scan the QR code (on the WhatsApp page)'
      : b.whatsappStatus === 'pairing'
      ? 'Enter the pairing PIN…'
      : b.whatsappStatus === 'connected'
      ? 'WhatsApp connected'
      : 'Connect your number';

  const go = (href) => navigate(href);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Get your store running</h1>
          <p className="muted">Follow these steps — most people finish in under 5 minutes.</p>
        </div>
      </div>

      <div className="panel setup-panel">
        <div className="setup-progress-row">
          <div className="setup-progress-label">
            {allDone ? 'All done — you are ready to sell! 🎉' : `${doneCount} of ${total} steps complete`}
          </div>
          <div className="setup-progress-track">
            <div className="setup-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="wizard">
          {steps.map((s, i) => {
            const isCurrent = s === current;
            const isDone = s.done;
            const locked = !isDone && !isCurrent;
            return (
              <div
                key={s.key}
                className={`wizard-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${locked ? 'locked' : ''}`}
              >
                <div className="wizard-num">{isDone ? '✓' : i + 1}</div>
                <div className="wizard-body">
                  <div className="wizard-title">{s.title}</div>
                  <div className="wizard-desc">{s.desc}</div>
                  {isCurrent && (
                    <div className="wizard-action">
                      <button className="btn primary" onClick={() => s.href && go(s.href)}>
                        {s.key === 'connect' && b.whatsappStatus !== 'connected'
                          ? connectLabel
                          : s.key === 'activate'
                          ? 'Open store on dashboard'
                          : 'Continue'}
                      </button>
                    </div>
                  )}
                  {isCurrent && s.key === 'connect' && (
                    <p className="muted wizard-hint">
                      This opens the WhatsApp page — scan the QR code with your phone (WhatsApp → Settings → Linked
                      devices). It may take 20–60 seconds to appear.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {allDone && (
        <div className="panel setup-done">
          <h2>Your AI sales bot is live</h2>
          <p className="muted">
            Customers who message <strong>+{b.whatsappNumber || 'your WhatsApp'}</strong> are answered instantly by the
            AI, can browse your catalog, and place orders.
          </p>
          <div className="setup-done-actions">
            <Link className="btn primary" to="/dashboard">
              Open dashboard
            </Link>
            <Link className="btn" to="/share">
              Share your store
            </Link>
            <Link className="btn" to="/settings">
              Customize settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
