const express = require('express');
const Business = require('../models/Business');
const Order = require('../models/Order');
const CatalogItem = require('../models/CatalogItem');
const ChatMessage = require('../models/ChatMessage');
const SessionLog = require('../models/SessionLog');
const { auth } = require('../middleware/auth');
const wa = require('../services/whatsappManager');

const router = express.Router();
router.use(auth);

router.get('/stats', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found' });
  const bId = business._id;

  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const [totalOrders, totalRevenue, totalConversations, catalogCount, sessionCount, activeSessions] = await Promise.all([
    Order.countDocuments({ business: bId }),
    Order.aggregate([{ $match: { business: bId, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    ChatMessage.distinct('conversationId', { business: bId }),
    CatalogItem.countDocuments({ business: bId }),
    SessionLog.countDocuments({ business: bId }),
    SessionLog.countDocuments({ business: bId, endedAt: null }),
  ]);

  const daily = await Order.aggregate([
    { $match: { business: bId, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const topProducts = await Order.aggregate([
    { $match: { business: bId, status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.title', qty: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } } } },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
  ]);

  const recentOrders = await Order.find({ business: bId }).sort({ createdAt: -1 }).limit(10);

  res.json({
    stats: {
      totalOrders,
      totalRevenue: totalRevenue[0] ? totalRevenue[0].total : 0,
      totalConversations: totalConversations.length,
      catalogCount,
      sessionCount,
      activeSessions,
      currency: business.currency || 'USD',
    },
    daily,
    topProducts,
    recentOrders,
    bot: {
      active: business.botActive,
      whatsappStatus: business.whatsappStatus,
      live: wa.state(bId)?.status || 'none',
    },
  });
});

module.exports = router;
