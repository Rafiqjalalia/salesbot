const mongoose = require('mongoose');

const catalogItemSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  currency: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  waId: { type: String, default: '' },
  slug: { type: String, required: true, unique: true },
  available: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CatalogItem', catalogItemSchema);
