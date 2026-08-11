const express = require('express');
const CatalogItem = require('../models/CatalogItem');
const Business = require('../models/Business');
const { env } = require('../config/env');

const router = express.Router();

function layout(title, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b1220;color:#e5eaf3;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
  .card{background:#111a2e;border:1px solid #22304f;border-radius:16px;max-width:420px;width:100%;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.45)}
  h1{font-size:22px;margin-bottom:6px}
  .sub{color:#8ea3c2;font-size:14px;margin-bottom:20px}
  img.cover{width:100%;border-radius:12px;max-height:260px;object-fit:cover;margin-bottom:18px;background:#22304f}
  .price{font-size:26px;font-weight:700;color:#22c55e;margin:10px 0}
  .desc{color:#b7c4dd;line-height:1.55;font-size:15px;margin-bottom:22px;white-space:pre-wrap}
  .btn{display:block;width:100%;text-align:center;background:#25d366;color:#06240f;font-weight:700;padding:14px;border-radius:12px;text-decoration:none;font-size:16px}
  .btn:hover{background:#1fb957}
  .meta{color:#8ea3c2;font-size:13px;text-align:center;margin-top:16px;line-height:1.6}
  .badge{display:inline-block;background:#22c55e;color:#06240f;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;margin-bottom:12px}
  img.qr{width:140px;height:140px;margin:14px auto;display:block;border-radius:10px;background:#fff;padding:8px}
  .chip{background:#17223b;border:1px solid #22304f;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:14px;color:#c3cfe6}
</style></head><body>${body}</body></html>`;
}

// Product page — shown when the bot sends a product link to a customer
router.get('/p/:slug', async (req, res) => {
  const item = await CatalogItem.findOne({ slug: req.params.slug, available: true });
  if (!item) return res.status(404).send(layout('Not found', '<div class="card"><h1>Product not found</h1></div>'));

  const business = await Business.findById(item.business);
  const currency = business ? business.currency || 'USD' : 'USD';
  const number = business ? business.whatsappNumber : '';
  const waText = encodeURIComponent(`Hi ${business ? business.name : 'there'}! I'm interested in "${item.title}" (${currency} ${item.price}). Can you help me order it?`);
  const waLink = number ? `https://wa.me/${number}?text=${waText}` : '';

  const body = `
    <div class="card">
      ${item.imageUrl ? `<img class="cover" src="${item.imageUrl}" alt="${item.title}" onerror="this.style.display='none'"/>` : ''}
      <span class="badge">${business ? business.name : 'Store'}</span>
      <h1>${item.title}</h1>
      <div class="price">${currency} ${Number(item.price).toFixed(2)}</div>
      <div class="desc">${item.description || 'No description yet.'}</div>
      ${waLink ? `<a class="btn" href="${waLink}" target="_blank">Buy on WhatsApp</a>` : ''}
      <div class="meta">${business && business.tagline ? business.tagline : ''}<br/>Powered by WhatsFlow</div>
    </div>`;
  res.send(layout(item.title, body));
});

// Public business card with WhatsApp QR — share this to customers
router.get('/b/:id', async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) return res.status(404).send(layout('Not found', '<div class="card"><h1>Business not found</h1></div>'));

  const number = business.whatsappNumber;
  const waLink = number ? `https://wa.me/${number}` : '';
  const qr = waLink ? await require('qrcode').toDataURL(waLink, { margin: 1, width: 200 }) : null;
  const items = await CatalogItem.find({ business: business._id, available: true }).sort('sortOrder').limit(6);

  const productList = items
    .map(
      (i) => `<div class="chip">${i.title} — ${business.currency || 'USD'} ${Number(i.price).toFixed(2)} &nbsp; <a href="${env.publicUrl}/p/${i.slug}" style="color:#38bdf8">View →</a></div>`
    )
    .join('');

  const body = `
    <div class="card">
      ${business.logoUrl ? `<img class="cover" src="${business.logoUrl}" style="max-height:140px"/>` : ''}
      <span class="badge">Open ${business.botActive ? 'Now' : 'Status unknown'}</span>
      <h1>${business.name}</h1>
      <div class="sub">${business.tagline || business.category || ''}</div>
      <div class="desc">${business.description || ''}</div>
      ${number ? `<div class="chip">WhatsApp: +${number}</div>` : ''}
      ${qr ? `<img class="qr" src="${qr}" alt="WhatsApp QR"/>` : ''}
      ${productList ? `<div style="margin-top:14px">${productList}</div>` : ''}
      ${waLink ? `<a class="btn" href="${waLink}" target="_blank" style="margin-top:16px">Chat on WhatsApp</a>` : ''}
      <div class="meta">Scan the QR or tap to chat<br/>Powered by WhatsFlow</div>
    </div>`;
  res.send(layout(business.name, body));
});

module.exports = router;
