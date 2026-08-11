const express = require('express');
const slugify = require('../utils/slugify');
const Business = require('../models/Business');
const CatalogItem = require('../models/CatalogItem');
const { auth } = require('../middleware/auth');
const whatsappManager = require('../services/whatsappManager');

const router = express.Router();
router.use(auth);

async function getBusiness(req, res) {
  const business = await Business.findOne({ user: req.userId });
  if (!business) {
    res.status(404).json({ error: 'No business found for this account' });
    return null;
  }
  return business;
}

router.get('/', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const items = await CatalogItem.find({ business: business._id }).sort({ sortOrder: 1 });
  res.json({ items });
});

router.post('/sync', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  try {
    const result = await whatsappManager.syncCatalog(business._id);
    res.json(result);
  } catch (e) {
    console.error(`[sync] failed:`, String((e && e.message) || e).slice(0, 200));
    res.status(400).json({ error: e.message });
  }
});

function parseBulkText(text) {
  const items = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      if (line.startsWith('{')) {
        const obj = JSON.parse(line);
        const title = String(obj.title || obj.name || '').trim();
        const price = parseFloat(obj.price);
        if (title && Number.isFinite(price)) {
          items.push({ title, price, description: String(obj.description || ''), imageUrl: String(obj.imageUrl || '') });
        }
        continue;
      }
    } catch {
      /* not JSON, fall through to pipe format */
    }
    const parts = line.split('|').map((s) => s.trim());
    const title = parts[0];
    const price = parseFloat(parts[1]);
    if (!title || !Number.isFinite(price)) continue;
    items.push({ title, price, description: parts[2] || '', imageUrl: parts[3] || '' });
  }
  return items;
}

router.post('/bulk', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  const items = parseBulkText((req.body && req.body.text) || '');
  if (!items.length) {
    return res.status(400).json({ error: 'No valid lines. Format: one product per line as  Name | Price | Description (optional)' });
  }

  const created = [];
  for (const it of items) {
    let doc = await CatalogItem.findOne({ business: business._id, title: it.title });
    if (doc) {
      doc.price = it.price;
      if (it.description) doc.description = it.description;
      if (it.imageUrl) doc.imageUrl = it.imageUrl;
      await doc.save();
      created.push(doc);
      continue;
    }
    let base = slugify(it.title) || 'item';
    let slug = base;
    let n = 0;
    while (await CatalogItem.findOne({ slug })) {
      n += 1;
      slug = `${base}-${n}`;
    }
    doc = await CatalogItem.create({
      business: business._id,
      title: it.title,
      description: it.description,
      price: it.price,
      imageUrl: it.imageUrl,
      slug,
    });
    created.push(doc);
  }
  res.json({ imported: created.length, items: created });
});

router.post('/', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  const { title, description, price, imageUrl, slug } = req.body;
  if (!title || price === undefined) return res.status(400).json({ error: 'Title and price are required' });

  let finalSlug = slug || slugify(title);
  // ensure unique slug
  let n = 0;
  while (await CatalogItem.findOne({ slug: finalSlug })) {
    n += 1;
    finalSlug = `${slug || slugify(title)}-${n}`;
  }

  const item = await CatalogItem.create({
    business: business._id,
    title: String(title).trim(),
    description: String(description || ''),
    price: parseFloat(price),
    imageUrl: String(imageUrl || ''),
    slug: finalSlug,
  });
  res.json({ item });
});

router.put('/:id', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  const item = await CatalogItem.findOne({ _id: req.params.id, business: business._id });
  if (!item) return res.status(404).json({ error: 'Item not found' });

  for (const k of ['title', 'description', 'price', 'imageUrl', 'slug', 'available', 'sortOrder']) {
    if (req.body[k] !== undefined) item[k] = req.body[k];
  }
  await item.save();
  res.json({ item });
});

router.delete('/:id', async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;
  await CatalogItem.deleteOne({ _id: req.params.id, business: business._id });
  res.json({ ok: true });
});

module.exports = router;
