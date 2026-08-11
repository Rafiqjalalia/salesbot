const mongoose = require('mongoose');

const sessionLogSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  messageCount: { type: Number, default: 0 },
});

module.exports = mongoose.model('SessionLog', sessionLogSchema);
