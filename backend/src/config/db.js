const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { env } = require('./env');

let mongod = null;

async function connectDb() {
  let uri = env.mongoUri;

  if (!uri) {
    // Auto-provision a local database so the app runs out of the box.
    // Data is persisted on disk (backend/.mongo) so accounts survive restarts.
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const dbPath = process.env.MONGO_DATA_PATH || path.join(__dirname, '..', '..', '.mongo');
    fs.mkdirSync(dbPath, { recursive: true });
    mongod = await MongoMemoryServer.create({ instance: { dbPath } });
    uri = mongod.getUri('whatsflow');
    console.log(`[db] No MONGODB_URI set — using automatic local database (${dbPath}).`);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('[db] Connected to MongoDB');
  return { uri, mongod };
}

async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop({ doCleanup: false });
}

module.exports = { connectDb, stopDb };
