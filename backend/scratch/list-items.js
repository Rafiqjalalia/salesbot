const { MongoClient } = require('mongodb');

(async () => {
  const port = process.argv[2];
  const c = new MongoClient(`mongodb://127.0.0.1:${port}`);
  await c.connect();
  const db = c.db('whatsflow');
  const items = await db.collection('catalogitems').find({}).toArray();
  items.forEach((i) => console.log(i.title, '| imageUrl:', JSON.stringify(i.imageUrl || '')));
  await c.close();
})().catch((e) => console.error('ERR', e.message));
