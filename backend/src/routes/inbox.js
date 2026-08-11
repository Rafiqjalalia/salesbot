const express = require('express');
const Business = require('../models/Business');
const ChatMessage = require('../models/ChatMessage');
const wa = require('../services/whatsappManager');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

const HANDOVER_MARKER = '__HANDOVER__';
const RESOLVED_MARKER = '__RESOLVED__';

router.get('/', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found' });
  const bId = business._id;

  const convos = await ChatMessage.aggregate([
    { $match: { business: bId } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$conversationId',
        lastMessage: { $first: '$text' },
        lastFrom: { $first: '$from' },
        lastAt: { $first: '$createdAt' },
        count: { $sum: 1 },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: 50 },
  ]);

  const markers = await ChatMessage.find({ business: bId, from: 'system', text: { $in: [HANDOVER_MARKER, RESOLVED_MARKER] } })
    .sort({ createdAt: -1 })
    .lean();

  const markerByConvo = {};
  for (const m of markers) {
    if (!markerByConvo[m.conversationId]) markerByConvo[m.conversationId] = m.text;
  }

  const conversations = convos.map((c) => ({
    id: c._id,
    number: c._id,
    lastMessage: c.lastMessage,
    lastFrom: c.lastFrom,
    lastAt: c.lastAt,
    count: c.count,
    handedOver: markerByConvo[c._id] === HANDOVER_MARKER,
  }));

  res.json({ conversations });
});

router.get('/:id/messages', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found' });
  const messages = await ChatMessage.find({ business: business._id, conversationId: req.params.id })
    .sort({ createdAt: 1 })
    .limit(200);
  res.json({ messages });
});

router.post('/:id/send', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found' });
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message text required' });

  try {
    await wa.sendAsBusiness(business._id, req.params.id, text);
    await ChatMessage.create({
      business: business._id,
      conversationId: req.params.id,
      from: 'ai',
      number: req.params.id,
      text,
    });
    // A manual owner reply resumes the AI for this conversation
    await wa.resolveHandover(business._id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/resolve', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found' });
  await wa.resolveHandover(business._id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
