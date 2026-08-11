const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  conversationId: { type: String, required: true },
  from: { type: String, enum: ['customer', 'ai', 'system'], required: true },
  number: { type: String, default: '' },
  text: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

chatMessageSchema.index({ business: 1, conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
