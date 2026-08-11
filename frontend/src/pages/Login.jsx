import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      onLogin(d.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">W</div>
        <h1>Welcome back</h1>
        <p className="auth-sub">Sign in to your WhatsFlow dashboard</p>
        {error && <div className="alert error">{error}</div>}
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" required />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" required />
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="auth-alt">
          New here? <Link to="/register">Create a business account</Link>
        </p>
      </form>
    </div>
  );
}
