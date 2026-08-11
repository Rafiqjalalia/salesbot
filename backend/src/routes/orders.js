const express = require('express');
const Business = require('../models/Business');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');

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
  const orders = await Order.find({ business: business._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ orders });
});

router.put('/:id/status', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const order = await Order.findOne({ _id: req.params.id, business: business._id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = req.body.status;
  await order.save();
  res.json({ order });
});

module.exports = router;
