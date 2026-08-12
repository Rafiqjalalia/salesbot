const express = require('express');
const QRCode = require('qrcode');
const Business = require('../models/Business');
const SessionLog = require('../models/SessionLog');
const { auth } = require('../middleware/auth');
const wa = require('../services/whatsappManager');
const { env } = require('../config/env');

const router = express.Router();
router.use(auth);

// Throttle auto-reconnects triggered from the status poll (one attempt per business
// every 10s). Without this, every status request would boot a new browser when the
// in-memory client is missing, which is exactly what happens after a server restart.
const autoReconnect = new Map(); // businessId -> last attempt timestamp

async function getBusiness(req, res) {
  const business = await Business.findOne({ user: req.userId });
  if (!business) {
    res.status(404).json({ error: 'No business found for this account' });
    return null;
  }
  return business;
}

router.get('/', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  res.json({ business });
});

router.put('/', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  const allowed = ['name', 'tagline', 'description', 'category', 'currency', 'logoUrl', 'website', 'ownerNumber'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) business[k] = req.body[k];
  }
  if (req.body.settings) {
    for (const k of ['welcomeMessage', 'awayMessage', 'aiModel', 'autoReply']) {
      if (req.body.settings[k] !== undefined) business.settings[k] = req.body.settings[k];
    }
  }
  await business.save();
  res.json({ business });
});

// ---- WhatsApp connection ----
router.post('/connect', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  try {
    await wa.connect(business._id);
    res.json({ ok: true, status: wa.state(business._id)?.status || 'connecting' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/connect/status', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const st = wa.state(business._id);

  // A connection that should be live (linking or connected) but has NO live client means the
  // server restarted or the instance was recycled. Instead of silently resetting to "never",
  // kick off a reconnect automatically so a fresh QR shows up in the dashboard by itself.
  if (!st && ['connecting', 'qr', 'pairing', 'authenticated', 'connected'].includes(business.whatsappStatus)) {
    const key = String(business._id);
    const last = autoReconnect.get(key) || 0;
    if (Date.now() - last > 10000) {
      autoReconnect.set(key, Date.now());
      wa.connect(business._id).catch((e) =>
        console.error(`[connect] auto-reconnect failed for ${key}:`, (e && e.message) || e)
      );
    }
    return res.json({ status: 'connecting', qr: null, pairingCode: null, error: '' });
  }

  const state = st || { status: business.whatsappStatus, qr: null, pairingCode: null, lastError: business.whatsappError };
  let qrDataUrl = null;
  if (state.qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(state.qr, { margin: 1, width: 320 });
    } catch {
      /* ignore */
    }
  }
  res.json({
    status: state.status,
    qr: qrDataUrl,
    pairingCode: state.pairingCode,
    error: state.lastError || business.whatsappError || '',
  });
});

router.post('/connect/pin', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  try {
    const code = await wa.pairPin(business._id, req.body.phone);
    res.json({ pairingCode: code, ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/disconnect', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  await wa.disconnect(business._id);
  res.json({ ok: true });
});

// ---- Store session (open / closed) ----
router.post('/session', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const active = Boolean(req.body.active);
  business.botActive = active;
  await business.save();

  if (active) {
    await SessionLog.create({ business: business._id });
  } else {
    await SessionLog.updateOne({ business: business._id, endedAt: null }, { endedAt: new Date() });
  }
  res.json({ botActive: business.botActive });
});

// ---- Share / business card info ----
router.get('/share', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const number = business.whatsappNumber || '';
  const waLink = number ? `https://wa.me/${number}` : '';
  const qr = number ? await QRCode.toDataURL(waLink, { margin: 1, width: 240 }) : null;
  res.json({
    name: business.name,
    tagline: business.tagline,
    description: business.description,
    whatsappNumber: number,
    waLink,
    qr,
    ownerNumber: business.ownerNumber,
    website: business.website,
    publicPage: `${env.publicUrl}/b/${business._id}`,
  });
});

module.exports = router;
