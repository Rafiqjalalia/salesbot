const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  customer: {
    number: { type: String, required: true },
    name: { type: String, default: '' },
  },
  items: [
    {
      title: String,
      price: Number,
      qty: Number,
    },
  ],
  total: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  note: { type: String, default: '' },
  status: {
    type: String,
    enum: ['new', 'confirmed', 'completed', 'cancelled'],
    default: 'new',
  },
  source: { type: String, default: 'whatsapp' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);
