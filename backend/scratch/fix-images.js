const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:59661');
  await c.connect();
  const db = c.db('whatsflow');
  const r = await db.collection('catalogitems').updateMany(
    { imageUrl: /wa\.me\/(p|c)\// },
    { $set: { imageUrl: '' } }
  );
  console.log('cleared imageUrl on', r.modifiedCount, 'items');
  await c.close();
})().catch((e) => console.error('ERR', e.message));
