const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const Business = require('../models/Business');
const CatalogItem = require('../models/CatalogItem');
const Order = require('../models/Order');
const ChatMessage = require('../models/ChatMessage');
const SessionLog = require('../models/SessionLog');
const salesAgent = require('../ai/salesAgent');
const slugify = require('../utils/slugify');
const { env } = require('../config/env');

const HANDOVER_MARKER = '__HANDOVER__';
const RESOLVED_MARKER = '__RESOLVED__';

// Run async event handlers without letting a rejection become unhandled.
const safe = (fn) => (...args) =>
  Promise.resolve()
    .then(() => fn(...args))
    .catch((e) => console.error('[wa] event error:', (e && e.message) || e));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A product's wa.me/p/... link is a WhatsApp product *page*, not an image file.
// Storing it as imageUrl makes the dashboard and share pages show a broken-image
// icon, so only keep URLs that actually point at an image.
function looksLikeImage(url) {
  if (!url) return false;
  const u = String(url);
  if (/^(data:image\/|blob:)/i.test(u)) return true;
  try {
    const parsed = new URL(u);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'wa.me' && parsed.pathname.startsWith('/p/')) return false;
    if (host === 'wa.me' && parsed.pathname.startsWith('/c/')) return false;
    return true;
  } catch {
    return false;
  }
}

// Kill any orphaned headless Chrome still holding a WhatsApp profile dir. On Windows a killed
// node process leaves Chrome children behind, which then lock the profile ("browser is already
// running") and block the next launch.
function killChromeForProfile(dataPath) {
  if (process.platform !== 'win32') return;
  try {
    const safePath = dataPath.replace(/'/g, "''");
    const script = [
      "$ps = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\"",
      'foreach ($x in $ps) {',
      "  if ($x.CommandLine -match [regex]::Escape('" + safePath + "')) {",
      '    Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue',
      '  }',
      '}',
    ].join('; ');
    const cmd = 'powershell -NoProfile -Command "' + script.replace(/"/g, '\\"') + '"';
    execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  } catch {
    /* ignore */
  }
}

function normalizeNumber(n) {
  return String(n || '').replace(/\D/g, '');
}

function cid(number) {
  return number; // conversation id = customer number
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined;
}

class WhatsAppManager {
  constructor() {
    this.clients = new Map(); // businessId -> { client, status, qr, pairingCode, lastError }
    fs.mkdirSync(env.dataDir, { recursive: true });
  }

  state(businessId) {
    return this.clients.get(String(businessId));
  }

  async initAll() {
    const businesses = await Business.find({ whatsappStatus: { $in: ['connected', 'connecting', 'pairing', 'qr', 'authenticated'] } });
    for (const b of businesses) {
      try {
        await this.connect(b._id);
      } catch (e) {
        console.error(`[wa] failed to restore session for ${b._id}:`, e.message);
      }
    }
    console.log(`[wa] restored ${businesses.length} business session(s)`);
  }

  buildClient(businessId, { pairingPhone = '', attempt = 1 } = {}) {
    const key = String(businessId);
    const dataPath = path.join(env.dataDir, key);
    const chrome = findChrome();
    if (chrome) console.log(`[wa] using browser: ${chrome}`);

    // Make sure no orphaned browser still holds this profile, then clear stale lock files.
    // A previous crash/kill can leave these behind and block the next launch with
    // "browser is already running". Only reached when no live client exists for this business.
    killChromeForProfile(dataPath);
    try {
      for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
        fs.rmSync(path.join(dataPath, f), { force: true });
      }
    } catch {
      /* ignore */
    }

    let authStrategy;
    if (env.mongoUri) {
      const store = new MongoStore({ mongoose });
      authStrategy = new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000,
        clientId: key,
      });
    } else {
      authStrategy = new LocalAuth({ dataPath });
    }

    const client = new Client({
      authStrategy,
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
      puppeteer: {
        headless: true,
        defaultViewport: { width: 1280, height: 800 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          // Low-memory / cloud-hosting flags
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--no-first-run',
          '--mute-audio',
          '--hide-scrollbars',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection',
        ],
        ...(chrome ? { executablePath: chrome } : {}),
      },

      ...(pairingPhone ? { pairWithPhoneNumber: { phoneNumber: pairingPhone, showNotification: true } } : {}),
    });

    const st = { client, status: 'connecting', qr: null, pairingCode: null, lastError: '', _attempt: attempt };
    this.clients.set(key, st);

    client.on('qr', safe(async (qr) => {
      clearTimeout(st._watchdog);
      st.qr = qr;
      st.status = 'qr';
      st.pairingCode = null;
      console.log(`[wa] QR ready for business ${key}`);
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'qr', whatsappError: '' });
    }));

    client.on('code', safe(async (code) => {
      clearTimeout(st._watchdog);
      st.pairingCode = code;
      st.status = 'pairing';
      st.qr = null;
      console.log(`[wa] pairing code ready for business ${key}`);
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'pairing', whatsappError: '' });
    }));

    client.on('authenticated', safe(async () => {
      clearTimeout(st._watchdog);
      st.status = 'authenticated';
      // After a reboot the saved session can authenticate but then never reach the "ready"
      // sync (headless WhatsApp Web stuck on the loading screen, common on slow machines
      // while it re-syncs a long chat history). Wait generously, then retry the whole boot
      // a couple of times — the second boot on a warm profile usually completes. Only after
      // all attempts ask the owner to re-link with a fresh QR code.
      st._readyWatchdog = setTimeout(async () => {
        if (st.status !== 'authenticated') return;
        console.warn(`[wa] session stuck after authentication for business ${key} (attempt ${st._attempt})`);
        try {
          await st.client.destroy();
        } catch {
          /* ignore */
        }
        if (this.clients.get(key) === st) this.clients.delete(key);
        if (st._attempt < 3) {
          // Give the old browser a full second to release the profile dir before relaunching,
          // otherwise the next launch collides with "browser is already running".
          await sleep(12000);
          killChromeForProfile(path.join(env.dataDir, key));
          this.connect(businessId, st._attempt + 1).catch((e) =>
            console.error(`[wa] stuck-retry failed for ${key}:`, (e && e.message) || e)
          );
          return;
        }
        st.status = 'failed';
        st.lastError = 'The saved session is stuck while syncing. Please reconnect by scanning a fresh QR code.';
        st._giveUp = true;
        console.warn(`[wa] session stuck after authentication for business ${key} — asking for re-link`);
        await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
      }, 240000);
    }));

    client.on('ready', safe(async () => {
      clearTimeout(st._watchdog);
      clearTimeout(st._readyWatchdog);
      st.status = 'connected';
      st.qr = null;
      st.pairingCode = null;
      
      let wid = '';
      if (client.info) {
        if (client.info.wid && client.info.wid.user) wid = client.info.wid.user;
        else if (client.info.me && client.info.me.user) wid = client.info.me.user;
      }
      
      await Business.updateOne({ _id: businessId }, {
        whatsappStatus: 'connected',
        whatsappError: '',
        ...(wid ? { whatsappNumber: wid } : {}),
      });
      console.log(`[wa] client ready for business ${key} (number ${wid || 'unknown'})`);
    }));

    client.on('auth_failure', safe(async (msg) => {
      clearTimeout(st._watchdog);
      clearTimeout(st._readyWatchdog);
      st.status = 'failed';
      st.lastError = String(msg || 'Authentication failed');
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
    }));

    client.on('disconnected', safe(async (reason) => {
      clearTimeout(st._watchdog);
      clearTimeout(st._readyWatchdog);
      console.warn(`[wa] client disconnected (${key}): ${reason}`);
      st.status = 'disconnected';
      st.lastError = String(reason || 'disconnected');
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'disconnected', whatsappError: st.lastError });
      // If we tore the client down ourselves (e.g. the connect watchdog gave up or the user
      // explicitly disconnected), do NOT auto-reconnect — that would restart the browser right
      // after we destroyed it and create an infinite loop on slow machines.
      if (st._giveUp) {
        if (this.clients.get(key) === st) this.clients.delete(key);
        return;
      }
      // Retry after a delay unless explicitly disconnected
      setTimeout(() => {
        if (this.clients.get(key) && this.clients.get(key).status === 'disconnected') {
          this.connect(businessId).catch((e) => console.error(`[wa] reconnect failed ${key}:`, e.message));
        }
      }, 15000);
    }));

    client.on('message', (msg) => this.handleMessage(businessId, msg).catch((e) => console.error('[wa] msg error:', e)));

    return st;
  }

  async connect(businessId, attempt = 1) {
    const key = String(businessId);
    const existing = this.clients.get(key);
    if (existing && (existing.status === 'connecting' || existing.status === 'connected' || existing.status === 'qr')) {
      return existing;
    }
    // Any leftover client (failed / disconnected / pairing) must be fully destroyed first,
    // otherwise its browser keeps the profile dir locked and the next launch fails with
    // "browser is already running".
    if (existing) {
      try {
        await existing.client.destroy();
      } catch {
        /* ignore */
      }
      this.clients.delete(key);
    }

    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');

    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'connecting', whatsappError: '' });

    const st = this.buildClient(businessId, { attempt });

    // Watchdog: if no QR/ready event arrives in time, clean up instead of spinning forever.
    // (A slow Chrome/WhatsApp load must never hang the UI on "preparing QR".) The window is
    // generous (180s) because some machines are very slow to boot Chrome, especially under
    // low memory; after giving up we set _giveUp so the disconnect handler won't reconnect.
    st._watchdog = setTimeout(async () => {
      if (st.status === 'connecting') {
        st.status = 'failed';
        st.lastError = 'Timed out preparing the QR code. Please retry.';
        st._giveUp = true;
        console.warn(`[wa] connect watchdog: giving up for business ${key} (no QR/ready in time)`);
        await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
        try {
          await st.client.destroy();
        } catch {
          /* ignore */
        }
        if (this.clients.get(key) === st) this.clients.delete(key);
      }
    }, 180000);

    // Kick off the browser in the background; status flows in through events (qr/ready/code...).
    // A crash on first launch (common under low memory) must not leave the app dead or the
    // browser holding the profile — retry a few times before giving up.
    this._initializeWithRetry(businessId, st, attempt);
    return st;
  }

  // whatsapp-web.js initialize() can fail on slow/low-RAM machines with
  // "Execution context was destroyed" (a renderer crashes while WhatsApp Web loads).
  // On failure we fully tear down the browser so the profile isn't locked, wait, and
  // relaunch. A warm profile usually boots fine on the second attempt.
  async _initializeWithRetry(businessId, st, attempt) {
    const key = String(businessId);
    try {
      await st.client.initialize();
    } catch (e) {
      clearTimeout(st._watchdog);
      clearTimeout(st._readyWatchdog);
      try {
        await st.client.destroy();
      } catch {
        /* ignore */
      }
      // destroy() only closes chrome if initialize() reached the browser — otherwise kill it
      // by profile path so the next launch isn't blocked by a stale browser.
      if (this.clients.get(key) === st) this.clients.delete(key);
      if (attempt < 3) {
        console.warn(`[wa] initialize attempt ${attempt} failed for ${key}: ${e.message} — retrying`);
        await sleep(10000);
        killChromeForProfile(path.join(env.dataDir, key));
        this.connect(businessId, attempt + 1).catch((e2) =>
          console.error(`[wa] retry failed for ${key}:`, (e2 && e2.message) || e2)
        );
        return;
      }
      const msg = String((e && e.message) || e);
      console.error(`[wa] initialize gave up for ${key}: ${msg}`);
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: msg });
    }
  }

  async pairPin(businessId, phone) {
    const key = String(businessId);
    const number = normalizeNumber(phone);
    if (!number) throw new Error('Enter the WhatsApp number in international format, e.g. 14155552671');

    const existing = this.clients.get(key);
    if (existing && existing.status === 'connected') throw new Error('Already connected');
    if (existing && existing.status === 'pairing') throw new Error('A pairing code was already requested — enter it in WhatsApp on your phone.');

    // Switch away from any QR session to pairing mode
    if (existing) {
      try {
        await existing.client.destroy();
      } catch {
        /* ignore */
      }
      this.clients.delete(key);
    }

    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');
    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'connecting', whatsappError: '' });

    const st = this.buildClient(businessId, { pairingPhone: number });
    st.client.initialize().catch(async (e) => {
      if (st.status === 'connecting') {
        st.status = 'failed';
        st.lastError = String((e && e.message) || e);
        await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
      }
    });

    // Wait for the pairing code to be produced (usually within a few seconds)
    const t0 = Date.now();
    while (!st.pairingCode && Date.now() - t0 < 45000) {
      if (st.status === 'failed' || st.status === 'disconnected') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!st.pairingCode) {
      st.status = 'failed';
      st.lastError = 'Could not generate a pairing code';
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
      throw new Error('Could not generate a pairing code. Please scan the QR code instead.');
    }

    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'pairing', whatsappError: '' });
    return st.pairingCode;
  }

  async disconnect(businessId) {
    const key = String(businessId);
    const st = this.clients.get(key);
    if (st) {
      try {
        await st.client.destroy();
      } catch {
        /* ignore */
      }
      this.clients.delete(key);
    }
    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'disconnected', whatsappError: 'Disconnected by owner' });
    // remove stored session so a fresh QR is required next time
    const dataPath = path.join(env.dataDir, key);
    fs.rmSync(dataPath, { recursive: true, force: true });
    
    // clear RemoteAuth if using MongoDB
    try {
      if (mongoose.connection && mongoose.connection.db) {
        await mongoose.connection.db.collection(`whatsapp-RemoteAuth-${key}.files`).drop().catch(() => {});
        await mongoose.connection.db.collection(`whatsapp-RemoteAuth-${key}.chunks`).drop().catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  }

  async syncCatalog(businessId) {
    const key = String(businessId);
    const st = this.clients.get(key);
    if (!st || st.status !== 'connected') {
      throw new Error('WhatsApp is not connected. Connect your number first.');
    }

    let raw;
    try {
      // Hard ceiling so a stalled page call can never hang the request forever
      const evaluatePromise = st.client.pupPage.evaluate(async () => {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const withTimeout = (p, ms) =>
          Promise.race([
            p,
            sleep(ms).then(() => {
              throw new Error('timed out');
            }),
          ]);

        let bridge = null;
        for (let i = 0; i < 40; i++) {
          try {
            bridge = window.require('WAWebBizProductCatalogBridge');
          } catch {
            /* module not loaded yet */
          }
          if (bridge) break;
          await sleep(250);
        }
        if (!bridge) {
          return { error: 'Catalog service not available. Make sure the connected number is a WhatsApp Business account with a catalog.' };
        }

        let sellerId = '';
        let platform = '';
        let isBusiness = false;
        try {
          const conn = window.require('WAWebConnModel').Conn;
          platform = String(conn.platform || '');
          isBusiness = !!conn.isBusiness;
        } catch {
          /* leave empty */
        }
        // The own phone-number wid moved off Conn.wid in current WhatsApp Web builds —
        // WAWebUserPrefsMeUser is the reliable source.
        try {
          sellerId = window.require('WAWebUserPrefsMeUser').getMaybeMePnUser()._serialized;
        } catch {
          try {
            const conn = window.require('WAWebConnModel').Conn;
            sellerId = conn.wid || '';
          } catch {
            sellerId = '';
          }
        }

        // Only WhatsApp Business accounts (platform smba/smbi) can have a catalog
        const looksBusiness = isBusiness || platform === 'smba' || platform === 'smbi';
        if (platform && !looksBusiness) {
          return {
            error:
              'This number is not a WhatsApp Business account, so it has no catalog to sync. Use the form to add products, or switch to a WhatsApp Business number.',
          };
        }

        const attempts = [];
        const extract = (res) => {
          if (res === null || res === undefined) return null;
          if (Array.isArray(res)) return res;
          if (Array.isArray(res.products)) return res.products;
          if (Array.isArray(res.productList)) return res.productList;
          return null;
        };
        const friendly = (errs) => {
          const joined = (errs.join(' | ') || '').toLowerCase();
          if (joined.includes('catalogunknownerror') || joined.includes('no catalog')) {
            return looksBusiness
              ? 'WhatsApp is not letting this device read your catalog (it blocks a business from importing its own catalog here). This is a WhatsApp restriction, not a bug. Use the "Paste products" button to add your products in one go — or add them one by one with the form. No catalog needed.'
              : 'This number is not a WhatsApp Business account, so it has no catalog to sync. Use the form to add products, or switch to a WhatsApp Business number.';
          }
          return errs.length ? `Could not read the catalog: ${errs.join(' | ')}` : 'The catalog is empty.';
        };

        for (const attempt of [
          () => bridge.queryCatalog(sellerId),
          () => bridge.queryCatalog(),
          () => bridge.queryProductList(sellerId),
        ]) {
          try {
            const products = extract(await withTimeout(attempt(), 12000));
            if (products) return { products };
          } catch (e) {
            attempts.push(String((e && e.message) || e));
          }
        }
        return { error: friendly(attempts) };
      });

      raw = await Promise.race([
        evaluatePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for WhatsApp')), 50000)),
      ]);
    } catch (e) {
      throw new Error(`Failed to reach the WhatsApp catalog: ${e.message}`);
    }

    if (raw && raw.error) {
      console.log(`[sync] bridge error for ${key}:`, JSON.stringify(raw.error).slice(0, 2000));
      // WhatsApp does not let a business read its own catalog from the web
      // session. Fall back to products the business has shared in chats.
      const fallback = await this.importFromProductMessages(businessId);
      if (fallback.imported + fallback.updated > 0) {
        return { ...fallback, source: 'messages' };
      }
      console.log(`[sync] fallback for ${key}:`, JSON.stringify(fallback.error || 'no products'));
      throw new Error(raw.error);
    }
    const products = (raw && raw.products) || [];
    if (!products.length) throw new Error('The catalog is empty. Add products in the WhatsApp Business app first.');

    return this.importProducts(businessId, products);
  }

  // Shared import: upsert products into the CatalogItem collection.
  async importProducts(businessId, products, { tagId = true } = {}) {
    let imported = 0;
    let updated = 0;
    const items = [];

    for (const p of products) {
      const waId = String(p.id || '').trim();
      let title = String(p.name || p.title || '').trim();
      if (!title) continue;
      if (waId && tagId) title = `${title} (${waId.split('@')[0]})`;

      const priceAmount1000 = parseFloat(p.priceAmount1000);
      const price = Number.isFinite(priceAmount1000)
        ? priceAmount1000 / 1000
        : parseFloat(p.price) || 0;
      const currency = String(p.currency || '');
      const rawImage = String(
        p.imageCdnUrl ||
          p.additionalImageCdnUrl ||
          p.imageUrl ||
          (p.images && p.images[0] && (p.images[0].url || p.images[0].imageUrl)) ||
          ''
      );
      const imageUrl = looksLikeImage(rawImage) ? rawImage : '';

      let doc = waId ? await CatalogItem.findOne({ business: businessId, waId }) : null;
      if (doc) {
        doc.title = title;
        doc.description = String(p.description || '');
        doc.price = price;
        doc.currency = currency;
        doc.imageUrl = imageUrl;
        await doc.save();
        updated += 1;
        items.push(doc);
        continue;
      }

      let base = slugify(title) || 'item';
      let slug = base;
      let n = 0;
      while (await CatalogItem.findOne({ slug })) {
        n += 1;
        slug = `${base}-${n}`;
      }
      doc = await CatalogItem.create({
        business: businessId,
        title,
        description: String(p.description || ''),
        price,
        currency,
        imageUrl,
        waId: waId || undefined,
        slug,
      });
      imported += 1;
      items.push(doc);
    }

    return { imported, updated, items };
  }

  // Fallback path: products the business has shared in chats arrive as product
  // messages carrying the full payload (title, price, currency, description,
  // image). Scan recent chats and import any found. Implemented as a single
  // in-page scan that skips broken chats individually (client.getChats() fails
  // entirely if one chat model misbehaves).
  async importFromProductMessages(businessId) {
    const key = String(businessId);
    const st = this.clients.get(key);
    if (!st || !st.client) return { imported: 0, updated: 0, items: [], error: 'WhatsApp is not connected.' };
    const client = st.client;

    let found = [];
    try {
      found = await client.pupPage.evaluate(async () => {
        const out = [];
        const seen = new Set();
        let chats = [];
        try {
          chats = window.require('WAWebCollections').Chat.getModelsArray() || [];
        } catch {
          return out;
        }
        for (const chat of chats.slice(0, 30)) {
          try {
            const msgs = (chat.getMsgs && chat.getMsgs()) || [];
            const recent = msgs.slice(-60);
            for (const m of recent) {
              const d = (m && m.serialize && m.serialize()) || m;
              if (!d || !d.productId) continue;
              if (seen.has(d.productId)) continue;
              seen.add(d.productId);
              const media = d.mediaData || {};
              out.push({
                id: d.productId,
                name: d.title || '',
                description: d.description || '',
                priceAmount1000: d.priceAmount1000,
                price: d.price,
                currency: d.currencyCode || '',
                imageCdnUrl: media.renderableUrl || d.renderableUrl || '',
              });
            }
          } catch {
            /* skip chat on error */
          }
        }
        return out;
      });
    } catch (e) {
      console.error(`[sync] chat scan failed for ${key}:`, (e && e.message) || e);
      return { imported: 0, updated: 0, items: [], error: 'Could not scan chats.' };
    }

    const products = Array.isArray(found) ? found : [];
    if (!products.length) {
      return { imported: 0, updated: 0, items: [], error: 'No product messages found in recent chats.' };
    }
    return this.importProducts(businessId, products, { tagId: false });
  }

  isHandedOver(businessId, conversationId) {
    // resolved in handleMessage via marker lookup
    return false;
  }

  async handleMessage(businessId, msg) {
    const from = String(msg.from || '');
    if (msg.fromMe) return;
    if (from.endsWith('@g.us')) return; // ignore groups
    if (msg.type === 'broadcast') return;
    if (from.endsWith('@newsletter')) return;

    const key = String(businessId);
    const st = this.clients.get(key);
    if (!st) return;

    const number = normalizeNumber(from.replace(/@c\.us$/, ''));
    if (!number) return;

    const conversationId = cid(number);
    const text = String(msg.body || '').trim();
    if (!text) return;

    const business = await Business.findById(businessId);
    if (!business) return;

    // Persist customer message
    await ChatMessage.create({ business: businessId, conversationId, from: 'customer', number, text });

    const handover = await this.lastMarker(businessId, conversationId);

    // If handed over, forward to the owner and stay quiet (human handles it)
    if (handover === HANDOVER_MARKER) {
      await this.forwardToOwner(business, number, text);
      return;
    }

    // Store closed / bot paused
    if (!business.botActive || !business.settings.autoReply) {
      await this.sendIfNeeded(st.client, businessId, number, business.settings.awayMessage || '', conversationId);
      return;
    }

    if (!st.client.info || !st.client.info.wid) {
      console.warn('[wa] client not fully ready, skipping message');
      return;
    }

    const catalog = await CatalogItem.find({ business: businessId, available: true }).sort('sortOrder');
    const history = await ChatMessage.find({ business: businessId, conversationId })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();
    const historyForAi = history.filter((m) => m.from !== 'system');

    let result;
    try {
      result = await salesAgent.generateReply({ business, catalog, history: historyForAi, customerText: text });
    } catch (e) {
      console.error('[ai] generateReply failed:', e.message);
      result = { reply: '', action: 'handover', customerName: '', order: {}, _aiError: e.message };
    }

    if (!result.reply && result.action !== 'handover') {
      result.action = 'handover';
    }

    if (result.reply) {
      await ChatMessage.create({ business: businessId, conversationId, from: 'ai', number, text: result.reply });
    }

    if (result.action === 'order') {
      const stOrder = this.clients.get(key);
      if (stOrder && stOrder.status === 'connected') {
        try {
          const confirmText = `${result.reply || ''}\n\n✅ Your order is confirmed! We'll get back to you soon.`;
          await stOrder.client.sendMessage(from, confirmText);
        } catch (e) {
          console.error('[wa] order confirm send failed:', e.message);
        }
      }
      await this.processOrder(business, number, result);
      return;
    }

    if (result.action === 'handover') {
      const fallback = "I'm not able to help with this one. Let me connect you to our human support right away.";
      const replyText = result.reply || fallback;
      await st.client.sendMessage(from, replyText);
      await ChatMessage.create({ business: businessId, conversationId, from: 'ai', number, text: replyText });
      await ChatMessage.create({ business: businessId, conversationId, from: 'system', number, text: HANDOVER_MARKER });
      await this.forwardToOwner(business, number, `Customer asked something I can't handle.\nLast message: ${text}\nFull conversation is on the dashboard inbox.`);
      await this.bumpSession(businessId);
      return;
    }

    // normal reply
    await st.client.sendMessage(from, result.reply);
    await this.bumpSession(businessId);
  }

  async processOrder(business, number, result) {
    const st = this.clients.get(String(business._id));
    const currency = business.currency || 'USD';
    const items = Array.isArray(result.order && result.order.items) ? result.order.items : [];
    const validItems = items
      .map((it) => ({ title: String(it.title || 'Item'), qty: Math.max(1, parseInt(it.qty, 10) || 1), price: parseFloat(it.price) || 0 }))
      .filter((it) => it.price >= 0 && it.title);

    const total = validItems.reduce((s, it) => s + it.qty * it.price, 0) || parseFloat(result.order.total) || 0;

    const order = await Order.create({
      business: business._id,
      customer: { number, name: result.customerName || '' },
      items: validItems.length ? validItems : [{ title: 'Custom request', qty: 1, price: total }],
      total,
      currency,
      note: String(result.order.note || ''),
    });

    // Notify the owner on WhatsApp
    const ownerNo = normalizeNumber(business.ownerNumber);
    if (ownerNo && st) {
      const lines = validItems.length
        ? validItems.map((it) => `- ${it.title} x${it.qty} = ${currency} ${(it.qty * it.price).toFixed(2)}`)
        : [`- Custom request (${currency} ${total.toFixed(2)})`];
      const ownerMsg = [
        `🛒 New order at ${business.name}!`,
        ...lines,
        `Total: ${currency} ${total.toFixed(2)}`,
        `Customer: +${number}`,
        result.customerName ? `Name: ${result.customerName}` : '',
        'Open your dashboard to manage it.',
      ].filter(Boolean).join('\n');
      try {
        await st.client.sendMessage(`${ownerNo}@c.us`, ownerMsg);
      } catch (e) {
        console.error('[wa] owner notify failed:', e.message);
      }
    }

    await this.bumpSession(business._id);
    return order;
  }

  async forwardToOwner(business, customerNumber, text) {
    const st = this.clients.get(String(business._id));
    const ownerNo = normalizeNumber(business.ownerNumber);
    if (!ownerNo || !st) return;
    try {
      await st.client.sendMessage(`${ownerNo}@c.us`, `📨 From customer +${customerNumber}:\n${text}`);
    } catch (e) {
      console.error('[wa] forward failed:', e.message);
    }
  }

  async lastMarker(businessId, conversationId) {
    const last = await ChatMessage.findOne({ business: businessId, conversationId, from: 'system' })
      .sort({ createdAt: -1 })
      .lean();
    return last ? last.text : null;
  }

  async resolveHandover(businessId, conversationId) {
    await ChatMessage.create({ business: businessId, conversationId, from: 'system', number: '', text: RESOLVED_MARKER });
  }

  async sendAsBusiness(businessId, to, text) {
    const st = this.clients.get(String(businessId));
    if (!st || st.status !== 'connected') throw new Error('WhatsApp not connected');
    const number = normalizeNumber(to);
    await st.client.sendMessage(`${number}@c.us`, text);
  }

  async sendIfNeeded(client, businessId, number, text, conversationId) {
    if (!text) return;
    const last = await ChatMessage.findOne({ business: businessId, conversationId })
      .sort({ createdAt: -1 })
      .lean();
    // avoid spamming the away message repeatedly
    if (last && last.from === 'ai' && last.text === text) return;
    await client.sendMessage(`${number}@c.us`, text);
  }

  async bumpSession(businessId) {
    const open = await SessionLog.findOne({ business: businessId, endedAt: null }).sort({ startedAt: -1 });
    if (open) {
      await SessionLog.updateOne({ _id: open._id }, { $inc: { messageCount: 1 } });
    }
  }

  async stats() {
    const connected = [...this.clients.values()].filter((s) => s.status === 'connected').length;
    return { clients: this.clients.size, connected };
  }
}

const manager = new WhatsAppManager();
module.exports = manager;
