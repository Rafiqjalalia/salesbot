const { chat, hasKey } = require('../services/groq');
const { env } = require('../config/env');

function productPageUrl(slug) {
  return `${env.publicUrl}/p/${slug}`;
}

function buildSystemPrompt(business, catalog) {
  const currency = business.currency || 'USD';
  const items = catalog
    .map(
      (i) =>
        `- ${i.title} | slug: ${i.slug} | Price: ${currency} ${i.price} | Link: ${productPageUrl(i.slug)} | Image: ${i.imageUrl || 'none'} | Description: ${(i.description || '').slice(0, 200)}`
    )
    .join('\n');

  return `You are an AI sales assistant for the business "${business.name}".
Your ONLY job is to help customers learn about products and buy them over WhatsApp.

Business info:
- Name: ${business.name}
- Tagline: ${business.tagline || 'n/a'}
- Description: ${business.description || 'n/a'}
- Currency: ${currency}

Available products (when showing a product, put its slug in the "products" array — the bot sends the photo automatically):
${items || '(no products configured yet)'}

RULES:
1. Be friendly, warm, concise and persuasive. Use the customer's language.
2. When a customer asks about a product, give details from the catalog. Include its link using the exact Link URL from the catalog (never localhost).
3. Gently convince the customer to buy: highlight benefits, offer to help choose, mention availability.
4. When the customer agrees to buy, confirm the order clearly (items, quantity, total price) and set action to "order".
5. Ask for customer name if not known.
6. If you cannot answer, the customer is confused/upset, or the question is beyond the catalog, set action to "handover" so a human can take over.
7. Keep replies under 300 characters.

You MUST reply with a single JSON object exactly shaped like this:
{
  "reply": "the message text to send to the customer",
  "action": "none" | "order" | "handover",
  "products": ["product-slug"],
  "customerName": "name if known, else empty string",
  "order": {
    "items": [ { "title": "...", "qty": 1, "price": 0 } ],
    "total": 0,
    "note": "optional short note"
  }
}
For action "none" the order field should be an empty object. Set "products" to the slug(s) of any catalog item you are showcasing (empty array if none).`;
}

function toChatMessage(from, text) {
  return { role: from === 'customer' ? 'user' : 'assistant', content: text };
}

async function generateReply({ business, catalog, history, customerText }) {
  if (!hasKey()) {
    return {
      reply:
        'I am not configured with an AI key yet. Please contact the store owner directly.',
      action: 'handover',
      customerName: '',
      order: {},
      _aiError: 'missing groq key',
    };
  }

  const messages = [{ role: 'system', content: buildSystemPrompt(business, catalog) }];
  for (const m of history.slice(-12)) {
    if (m.from === 'ai' || m.from === 'customer') messages.push(toChatMessage(m.from, m.text));
  }
  messages.push({ role: 'user', content: customerText });

  const raw = await chat(messages, { json: true, temperature: 0.6 });
  const parsed = parseJson(raw);
  return {
    reply: String(parsed.reply || '').trim(),
    action: ['order', 'handover', 'none'].includes(parsed.action) ? parsed.action : 'none',
    products: Array.isArray(parsed.products)
      ? parsed.products.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
    customerName: String(parsed.customerName || '').trim(),
    order: parsed.order && typeof parsed.order === 'object' ? parsed.order : {},
    _raw: raw,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
  }
  return {};
}

module.exports = { generateReply };
