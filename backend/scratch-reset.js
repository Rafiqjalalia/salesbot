const mongoose = require('mongoose');
const Business = require('./src/models/Business');
(async () => {
  const port = process.argv[2];
  await mongoose.connect(`mongodb://127.0.0.1:${port}/whatsflow`, { serverSelectionTimeoutMS: 10000 });
  const r = await Business.updateMany({}, { $set: { whatsappStatus: 'connecting', whatsappError: '' } });
  console.log('reset', r.modifiedCount, 'business(es) to connecting');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
