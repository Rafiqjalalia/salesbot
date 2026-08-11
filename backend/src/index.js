const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDb, stopDb } = require('./config/db');
const { env } = require('./config/env');
const wa = require('./services/whatsappManager');

// Never let a stray rejection/exception take the whole platform down.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.message : reason);
  if (reason instanceof Error && reason.stack) console.error('[server] stack:', reason.stack.split('\n').slice(0, 8).join('\n'));
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.message);
  if (err && err.stack) console.error('[server] stack:', err.stack.split('\n').slice(0, 8).join('\n'));
});

async function main() {
  await connectDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // API
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/business', require('./routes/business'));
  app.use('/api/catalog', require('./routes/catalog'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/inbox', require('./routes/inbox'));
  app.use('/api/setup', require('./routes/setup'));

  // Public product & business pages
  app.use(require('./routes/public'));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Serve built frontend (if present)
  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (require('fs').existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|p\/|b\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[api] error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  });

  const server = app.listen(env.port, () => {
    console.log(`[server] WhatsFlow running on ${env.publicUrl}`);
    if (!env.groqApiKey) console.warn('[server] WARNING: GROQ_API_KEY is not set — the AI bot will hand everything over to a human. Add it to backend/.env');
  });

  // Restore WhatsApp sessions
  setTimeout(() => wa.initAll().catch((e) => console.error('[wa] initAll failed:', e)), 1000);

  const shutdown = async () => {
    console.log('[server] shutting down...');
    server.close();
    await stopDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[server] fatal:', e);
  process.exit(1);
});
