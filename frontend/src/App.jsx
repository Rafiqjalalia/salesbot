import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from 'react-router-dom';
import { getToken, setToken, api } from './api';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Connect from './pages/Connect';
import Catalog from './pages/Catalog';
import Orders from './pages/Orders';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import Share from './pages/Share';
import Setup from './pages/Setup';

function Sidebar({ user, onLogout, path }) {
  const navItems = [
    { to: '/', label: 'Dashboard', icon: '📊' },
    { to: '/setup', label: 'Setup', icon: '🚀' },
    { to: '/connect', label: 'WhatsApp', icon: '🔗' },
    { to: '/catalog', label: 'Catalog', icon: '📦' },
    { to: '/orders', label: 'Orders', icon: '🧾' },
    { to: '/inbox', label: 'Inbox', icon: '💬' },
    { to: '/share', label: 'Share', icon: '🔗' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ];
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-mark">W</span>
        <div>
          <strong>WhatsFlow</strong>
          <small>AI Sales Bot</small>
        </div>
      </div>
      <nav>
        {navItems.map((n) => (
          <Link key={n.to} to={n.to} className={`nav-item ${path === n.to ? 'active' : ''}`}>
            <span>{n.icon}</span> {n.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="user-chip">
          <div className="avatar">{user?.name?.[0] || 'U'}</div>
          <div>
            <div className="user-name">{user?.name || 'User'}</div>
            <button className="link-btn" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Shell({ user, setUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const logout = () => {
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  return (
    <div className="app">
      <Sidebar user={user} onLogout={logout} path={path} />
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/share" element={<Share />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const d = await api('/api/auth/me');
        setUser(d.user);
      } catch {
        setToken(null);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="boot">Loading…</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="/register" element={<Register onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return <Shell user={user} setUser={setUser} />;
}
