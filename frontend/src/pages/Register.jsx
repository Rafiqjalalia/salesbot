import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/auth/register', { method: 'POST', body: form });
      setToken(d.token);
      onLogin(d.user);
      navigate('/setup');
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
        <h1>Start your AI store</h1>
        <p className="auth-sub">Create your business account — it takes 1 minute</p>
        {error && <div className="alert error">{error}</div>}
        <label>Your name</label>
        <input value={form.name} onChange={set('name')} placeholder="Jane Doe" required />
        <label>Business name</label>
        <input value={form.businessName} onChange={set('businessName')} placeholder="Jane's Bakery" required />
        <label>Email</label>
        <input value={form.email} onChange={set('email')} type="email" placeholder="you@company.com" required />
        <label>Password</label>
        <input value={form.password} onChange={set('password')} type="password" placeholder="Min 6 characters" minLength={6} required />
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="auth-alt">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
