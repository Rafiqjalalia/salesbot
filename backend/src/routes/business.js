const express = require('express');
const QRCode = require('qrcode');
const Business = require('../models/Business');
const SessionLog = require('../models/SessionLog');
const { auth } = require('../middleware/auth');
const wa = require('../services/whatsappManager');
const { env } = require('../config/env');

const router = express.Router();
router.use(auth);

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

  // A status like 'qr'/'connecting' stored in the DB but with NO live client is stale
  // (e.g. the server restarted). Report it as not-started so the UI shows the Start button
  // instead of waiting forever on a QR that will never come.
  if (!st && ['connecting', 'qr', 'pairing'].includes(business.whatsappStatus)) {
    await Business.updateOne({ _id: business._id }, { whatsappStatus: 'never', whatsappError: '' });
    return res.json({ status: 'never', qr: null, pairingCode: null, error: '' });
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
