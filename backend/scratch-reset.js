require('dotenv').config();
const mongoose = require('mongoose');

async function resetAuth() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');
  
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  for (const c of collections) {
    if (c.name.startsWith('whatsapp-RemoteAuth-')) {
      console.log('Dropping collection:', c.name);
      await db.collection(c.name).drop();
    }
  }
  
  console.log('Reset complete!');
  process.exit(0);
}

resetAuth().catch(console.error);
