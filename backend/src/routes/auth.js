const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Business = require('../models/Business');
const { auth } = require('../middleware/auth');
const { env } = require('../config/env');

const router = express.Router();

function sign(user) {
  return jwt.sign({ userId: user._id }, env.jwtSecret, { expiresIn: '30d' });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, businessName } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

    const user = await User.create({
      name,
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(String(password), 10),
    });

    const business = await Business.create({
      user: user._id,
      name: businessName || `${name}'s Store`,
    });

    return res.json({ token: sign(user), user: { id: user._id, name: user.name, email: user.email, businessId: business._id } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: String(email || '').toLowerCase() });
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const business = await Business.findOne({ user: user._id });
    return res.json({
      token: sign(user),
      user: { id: user._id, name: user.name, email: user.email, businessId: business ? business._id : null },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Session expired — please log in again' });
  const business = await Business.findOne({ user: req.userId });
  res.json({
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    businessId: business ? business._id : null,
  });
});

// Bootstrap the admin account on first run (used for quick local demo)
router.post('/bootstrap', async (req, res) => {
  try {
    const exists = await User.findOne({ email: String(env.adminEmail).toLowerCase() });
    if (exists) return res.status(200).json({ ok: true, already: true });
    await User.create({
      name: 'Admin',
      email: String(env.adminEmail).toLowerCase(),
      passwordHash: await bcrypt.hash(env.adminPassword, 10),
      role: 'admin',
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
