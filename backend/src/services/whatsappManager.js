const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const pino = require('pino');
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

const baileysPromise = import('@whiskeysockets/baileys');
const logger = pino({ level: 'silent' });

async function loadBaileys() {
  return baileysPromise;
}

// Run async event handlers without letting a rejection become unhandled.
const safe = (fn) => (...args) =>
  Promise.resolve()
    .then(() => fn(...args))
    .catch((e) => console.error('[wa] event error:', (e && e.message) || e));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function normalizeNumber(n) {
  return String(n || '').replace(/\D/g, '');
}

function cid(number) {
  return number;
}

function jidToNumber(jid) {
  if (!jid) return '';
  return normalizeNumber(String(jid).split('@')[0].split(':')[0]);
}

function toJid(number) {
  const n = normalizeNumber(number);
  return n ? `${n}@s.whatsapp.net` : '';
}

function messageText(msg, { getContentType, extractMessageContent }) {
  const content = extractMessageContent(msg.message);
  if (!content) return '';
  const type = getContentType(content);
  if (type === 'conversation') return String(content.conversation || '');
  if (type === 'extendedTextMessage') return String(content.extendedTextMessage?.text || '');
  if (type === 'imageMessage') return String(content.imageMessage?.caption || '');
  if (type === 'videoMessage') return String(content.videoMessage?.caption || '');
  return '';
}

async function useMongoAuthState(businessId, baileys) {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  const col = mongoose.connection.db.collection('baileys_auth_files');
  const key = String(businessId);

  const readData = async (file) => {
    const doc = await col.findOne({ businessId: key, file });
    if (!doc?.data) return null;
    return JSON.parse(doc.data, BufferJSON.reviver);
  };

  const writeData = async (data, file) => {
    await col.updateOne(
      { businessId: key, file },
      { $set: { data: JSON.stringify(data, BufferJSON.replacer), updatedAt: new Date() } },
      { upsert: true }
    );
  };

  const removeData = async (file) => {
    await col.deleteOne({ businessId: key, file });
  };

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');
  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => writeData(creds, 'creds.json'),
    clearAll: async () => col.deleteMany({ businessId: key }),
  };
}

class WhatsAppManager {
  constructor() {
    this.clients = new Map(); // businessId -> session state
    fs.mkdirSync(env.dataDir, { recursive: true });
  }

  state(businessId) {
    return this.clients.get(String(businessId));
  }

  async _loadAuth(businessId) {
    const baileys = await loadBaileys();
    const key = String(businessId);
    const dataPath = path.join(env.dataDir, key);

    if (env.mongoUri && mongoose.connection?.db) {
      return useMongoAuthState(businessId, baileys);
    }
    return baileys.useMultiFileAuthState(dataPath);
  }

  async _destroySocket(st) {
    if (!st?.sock) return;
    try {
      st.sock.ev.removeAllListeners('connection.update');
      st.sock.ev.removeAllListeners('creds.update');
      st.sock.ev.removeAllListeners('messages.upsert');
      await st.sock.end(undefined);
    } catch {
      /* ignore */
    }
    st.sock = null;
  }

  _clearTimers(st) {
    if (st._watchdog) clearTimeout(st._watchdog);
    if (st._readyWatchdog) clearTimeout(st._readyWatchdog);
  }

  async _markConnected(businessId, st) {
    if (st.status === 'connected') return;
    this._clearTimers(st);
    st.status = 'connected';
    st.qr = null;
    st.pairingCode = null;

    const wid =
      jidToNumber(st.sock?.user?.id) ||
      jidToNumber(st.authState?.creds?.me?.id) ||
      '';

    await Business.updateOne(
      { _id: businessId },
      {
        whatsappStatus: 'connected',
        whatsappError: '',
        ...(wid ? { whatsappNumber: wid } : {}),
      }
    );
    console.log(`[wa] client ready for business ${String(businessId)} (number ${wid || 'unknown'})`);
  }

  async initAll() {
    const businesses = await Business.find({
      whatsappStatus: { $in: ['connected', 'connecting', 'pairing', 'qr', 'authenticated'] },
    });
    for (const b of businesses) {
      try {
        await this.connect(b._id);
      } catch (e) {
        console.error(`[wa] failed to restore session for ${b._id}:`, e.message);
      }
    }
    console.log(`[wa] restored ${businesses.length} business session(s)`);
  }

  async buildClient(businessId, { pairingPhone = '', attempt = 1 } = {}) {
    const baileys = await loadBaileys();
    const {
      makeWASocket,
      fetchLatestBaileysVersion,
      DisconnectReason,
      makeCacheableSignalKeyStore,
      getContentType,
      extractMessageContent,
      isJidGroup,
      bindWaitForConnectionUpdate,
    } = baileys;

    const key = String(businessId);
    const { state, saveCreds, clearAll } = await this._loadAuth(businessId);
    const { version } = await fetchLatestBaileysVersion();

    const st = {
      sock: null,
      authState: state,
      saveCreds,
      clearAuth: clearAll,
      status: 'connecting',
      qr: null,
      pairingCode: null,
      lastError: '',
      _attempt: attempt,
      _giveUp: false,
    };
    this.clients.set(key, st);

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    st.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on(
      'connection.update',
      safe(async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        if (qr) {
          clearTimeout(st._watchdog);
          if (!pairingPhone) {
            st.qr = qr;
            st.status = 'qr';
            st.pairingCode = null;
            console.log(`[wa] QR ready for business ${key}`);
            await Business.updateOne({ _id: businessId }, { whatsappStatus: 'qr', whatsappError: '' });
          }
        }

        if (isNewLogin) {
          clearTimeout(st._watchdog);
          st.status = 'authenticated';
          st.qr = null;
          st.pairingCode = null;
          console.log(`[wa] device authenticated for business ${key} — finishing link`);
          await Business.updateOne({ _id: businessId }, { whatsappStatus: 'authenticated', whatsappError: '' });
        }

        if (connection === 'open') {
          await this._markConnected(businessId, st);
        }

        if (connection === 'close') {
          this._clearTimers(st);
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.message || 'disconnected';
          console.warn(`[wa] client disconnected (${key}): ${reason}`);

          if (st.status !== 'failed') {
            st.status = 'disconnected';
            st.lastError = String(reason);
            await Business.updateOne(
              { _id: businessId },
              { whatsappStatus: 'disconnected', whatsappError: st.lastError }
            );
          }

          if (st._giveUp) {
            if (this.clients.get(key) === st) this.clients.delete(key);
            return;
          }

          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const badSession = statusCode === DisconnectReason.badSession;
          if (loggedOut || badSession) {
            st._giveUp = true;
            if (this.clients.get(key) === st) this.clients.delete(key);
            return;
          }

          setTimeout(() => {
            if (this.clients.get(key) === st && st.status === 'disconnected') {
              this.connect(businessId).catch((e) =>
                console.error(`[wa] reconnect failed ${key}:`, (e && e.message) || e)
              );
            }
          }, 15000);
        }
      })
    );

    sock.ev.on(
      'messages.upsert',
      safe(async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          await this.handleMessage(businessId, msg, { getContentType, extractMessageContent, isJidGroup });
        }
      })
    );

    if (pairingPhone) {
      this._requestPairingCode(businessId, st, pairingPhone, bindWaitForConnectionUpdate).catch((e) =>
        console.error(`[wa] pairing request failed for ${key}:`, (e && e.message) || e)
      );
    }

    return st;
  }

  async _requestPairingCode(businessId, st, phone, bindWaitForConnectionUpdate) {
    const key = String(businessId);
    try {
      await bindWaitForConnectionUpdate(st.sock.ev, () => true, 90000);
      const code = await st.sock.requestPairingCode(phone);
      clearTimeout(st._watchdog);
      st.pairingCode = code;
      st.status = 'pairing';
      st.qr = null;
      console.log(`[wa] pairing code ready for business ${key}`);
      await Business.updateOne({ _id: businessId }, { whatsappStatus: 'pairing', whatsappError: '' });
    } catch (e) {
      if (st.status === 'connecting' || st.status === 'pairing') {
        st.status = 'failed';
        st.lastError = String((e && e.message) || e);
        await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
      }
      throw e;
    }
  }

  async connect(businessId, attempt = 1) {
    const key = String(businessId);
    const existing = this.clients.get(key);
    if (existing && ['connecting', 'connected', 'qr', 'authenticated', 'pairing'].includes(existing.status)) {
      return existing;
    }

    if (existing) {
      existing._giveUp = true;
      await this._destroySocket(existing);
      this.clients.delete(key);
    }

    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');

    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'connecting', whatsappError: '' });

    const st = await this.buildClient(businessId, { attempt });

    st._watchdog = setTimeout(async () => {
      if (st.status === 'connecting') {
        st.status = 'failed';
        st.lastError = 'Timed out preparing the QR code. Please retry.';
        st._giveUp = true;
        console.warn(`[wa] connect watchdog: giving up for business ${key} (no QR/open in time)`);
        await Business.updateOne({ _id: businessId }, { whatsappStatus: 'failed', whatsappError: st.lastError });
        await this._destroySocket(st);
        if (this.clients.get(key) === st) this.clients.delete(key);
      }
    }, 180000);

    return st;
  }

  async pairPin(businessId, phone) {
    const key = String(businessId);
    const number = normalizeNumber(phone);
    if (!number) throw new Error('Enter the WhatsApp number in international format, e.g. 14155552671');

    const existing = this.clients.get(key);
    if (existing && existing.status === 'connected') throw new Error('Already connected');
    if (existing && existing.status === 'pairing') {
      throw new Error('A pairing code was already requested — enter it in WhatsApp on your phone.');
    }

    if (existing) {
      existing._giveUp = true;
      await this._destroySocket(existing);
      this.clients.delete(key);
    }

    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');
    await Business.updateOne({ _id: businessId }, { whatsappStatus: 'connecting', whatsappError: '' });

    const st = await this.buildClient(businessId, { pairingPhone: number });

    const t0 = Date.now();
    while (!st.pairingCode && Date.now() - t0 < 45000) {
      if (st.status === 'failed' || st.status === 'disconnected') break;
      await sleep(500);
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
      st._giveUp = true;
      try {
        await st.sock?.logout();
      } catch {
        await this._destroySocket(st);
      }
      this.clients.delete(key);
    }

    await Business.updateOne(
      { _id: businessId },
      { whatsappStatus: 'disconnected', whatsappError: 'Disconnected by owner' }
    );

    const dataPath = path.join(env.dataDir, key);
    fs.rmSync(dataPath, { recursive: true, force: true });

    try {
      if (mongoose.connection?.db) {
        await mongoose.connection.db.collection('baileys_auth_files').deleteMany({ businessId: key });
      }
    } catch {
      /* ignore */
    }
  }

  async syncCatalog(businessId) {
    const key = String(businessId);
    const st = this.clients.get(key);
    if (!st || st.status !== 'connected') {
      throw new Error('WhatsApp is not connected. Connect your number first.');
    }

    const fallback = await this.importFromProductMessages(businessId);
    if (fallback.imported + fallback.updated > 0) {
      return { ...fallback, source: 'messages' };
    }

    throw new Error(
      fallback.error ||
        'Catalog sync is not available without WhatsApp Web. Use "Paste products" or add items manually in the dashboard.'
    );
  }

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

  async importFromProductMessages(businessId) {
    return {
      imported: 0,
      updated: 0,
      items: [],
      error:
        'Could not scan chats for product messages. Add products with "Paste products" or the manual form instead.',
    };
  }

  isHandedOver() {
    return false;
  }

  async handleMessage(businessId, msg, helpers) {
    if (msg.key.fromMe) return;

    const remoteJid = String(msg.key.remoteJid || '');
    if (helpers.isJidGroup(remoteJid)) return;
    if (remoteJid.endsWith('@newsletter') || remoteJid.endsWith('@broadcast')) return;

    const key = String(businessId);
    const st = this.clients.get(key);
    if (!st || st.status !== 'connected' || !st.sock) return;

    const number = jidToNumber(remoteJid);
    if (!number) return;

    const conversationId = cid(number);
    const text = messageText(msg, helpers).trim();
    if (!text) return;

    const business = await Business.findById(businessId);
    if (!business) return;

    await ChatMessage.create({ business: businessId, conversationId, from: 'customer', number, text });

    const handover = await this.lastMarker(businessId, conversationId);

    if (handover === HANDOVER_MARKER) {
      await this.forwardToOwner(business, number, text);
      return;
    }

    if (!business.botActive || !business.settings.autoReply) {
      await this.sendIfNeeded(st.sock, businessId, number, business.settings.awayMessage || '', conversationId);
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

    const jid = toJid(number);

    if (result.action === 'order') {
      const stOrder = this.clients.get(key);
      if (stOrder && stOrder.status === 'connected' && stOrder.sock) {
        try {
          const confirmText = `${result.reply || ''}\n\n✅ Your order is confirmed! We'll get back to you soon.`;
          await stOrder.sock.sendMessage(jid, { text: confirmText });
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
      await st.sock.sendMessage(jid, { text: replyText });
      await ChatMessage.create({ business: businessId, conversationId, from: 'ai', number, text: replyText });
      await ChatMessage.create({ business: businessId, conversationId, from: 'system', number, text: HANDOVER_MARKER });
      await this.forwardToOwner(
        business,
        number,
        `Customer asked something I can't handle.\nLast message: ${text}\nFull conversation is on the dashboard inbox.`
      );
      await this.bumpSession(businessId);
      return;
    }

    await st.sock.sendMessage(jid, { text: result.reply });
    await this.bumpSession(businessId);
  }

  async processOrder(business, number, result) {
    const st = this.clients.get(String(business._id));
    const currency = business.currency || 'USD';
    const items = Array.isArray(result.order && result.order.items) ? result.order.items : [];
    const validItems = items
      .map((it) => ({
        title: String(it.title || 'Item'),
        qty: Math.max(1, parseInt(it.qty, 10) || 1),
        price: parseFloat(it.price) || 0,
      }))
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

    const ownerNo = normalizeNumber(business.ownerNumber);
    if (ownerNo && st?.sock) {
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
      ]
        .filter(Boolean)
        .join('\n');
      try {
        await st.sock.sendMessage(toJid(ownerNo), { text: ownerMsg });
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
    if (!ownerNo || !st?.sock) return;
    try {
      await st.sock.sendMessage(toJid(ownerNo), { text: `📨 From customer +${customerNumber}:\n${text}` });
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
    await ChatMessage.create({
      business: businessId,
      conversationId,
      from: 'system',
      number: '',
      text: RESOLVED_MARKER,
    });
  }

  async sendAsBusiness(businessId, to, text) {
    const st = this.clients.get(String(businessId));
    if (!st || st.status !== 'connected' || !st.sock) throw new Error('WhatsApp not connected');
    const number = normalizeNumber(to);
    await st.sock.sendMessage(toJid(number), { text });
  }

  async sendIfNeeded(sock, businessId, number, text, conversationId) {
    if (!text) return;
    const last = await ChatMessage.findOne({ business: businessId, conversationId })
      .sort({ createdAt: -1 })
      .lean();
    if (last && last.from === 'ai' && last.text === text) return;
    await sock.sendMessage(toJid(number), { text });
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
