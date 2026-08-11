const path = require('path');
const dotenv = require('dotenv');

// Always load backend/.env no matter what the working directory is.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  mongoUri: process.env.MONGODB_URI || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', '..', '.wdata'),
};

module.exports = { env };
