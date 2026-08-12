const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  tagline: { type: String, default: '' },
  description: { type: String, default: '' },
  category: { type: String, default: '' },
  currency: { type: String, default: 'USD' },
  logoUrl: { type: String, default: '' },
  website: { type: String, default: '' },

  // The WhatsApp number the BOT runs on (full international, digits only)
  whatsappNumber: { type: String, default: '' },
  // The owner's personal WhatsApp number for order notifications & handover
  ownerNumber: { type: String, default: '' },

  // WhatsApp connection state
  whatsappStatus: {
    type: String,
    enum: ['never', 'connecting', 'qr', 'pairing', 'authenticated', 'connected', 'failed', 'disconnected'],
    default: 'never',
  },
  whatsappError: { type: String, default: '' },

  // Store session (on/off) toggle
  botActive: { type: Boolean, default: true },

  settings: {
    welcomeMessage: { type: String, default: '' },
    awayMessage: { type: String, default: 'We are currently closed. Please message us again during our opening hours. Thank you!' },
    aiModel: { type: String, default: '' },
    autoReply: { type: Boolean, default: true },
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Business', businessSchema);
