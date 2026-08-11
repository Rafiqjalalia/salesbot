# WhatsFlow — AI WhatsApp Sales Bot (SaaS)

A white-label SaaS platform that lets any business turn a WhatsApp number into an AI sales assistant.

## Features

- **Connect WhatsApp** with QR code *or* 6–8 digit pairing PIN (whatsapp-web.js, dedicated browser session per business). The app auto-detects an installed Chrome/Edge/Chromium browser.
- **AI conversations** powered by Groq (Llama 3.3) — answers questions, recommends products, persuades and closes sales in the customer's language.
- **Catalog as links** — the AI sends each product as a shareable page (`/p/<slug>`) with a "Buy on WhatsApp" button.
- **Sync from WhatsApp Business Catalog** — one click imports products already saved in the business's own WhatsApp catalog (Business accounts with a catalog only; the connected number must be WhatsApp Business).
- **Product info & upselling** — the bot explains items, highlights benefits and convinces the customer to buy.
- **Order notification** — every order is created in the database and instantly messaged to the owner's WhatsApp.
- **Shareable business card** — an interactive page (`/b/<businessId>`) with business info, WhatsApp number, owner QR code and product links.
- **Start / end sessions** — owners open or pause the store from the dashboard (away message sent when closed).
- **Sales dashboard** — revenue, orders, conversations, 14-day chart, top products, recent orders.
- **Human handover** — when the AI can't handle something it politely hands the customer to a human, forwards the conversation to the owner, and flags it in the Inbox where the owner can reply directly and resume the AI.

## Quick start (no server experience needed)

### Option A — local (Windows / Mac / Linux)

Prerequisites: [Node.js 18+](https://nodejs.org) (or Docker).

```bash
# from the project folder:
npm run install:all     # installs backend + frontend + builds the dashboard
npm start               # starts the server on http://localhost:3000
```

Open **http://localhost:3000**, create an account and follow the setup steps. No MongoDB install needed — the app auto-provisions a local database that is **persisted on disk** in `backend/.mongo`, so accounts and data survive server restarts. (Set `MONGODB_URI` in `backend/.env` to use your own MongoDB instead.)

### Option B — Docker (recommended for selling / hosting)

```bash
# 1. set your API key
echo "GROQ_API_KEY=gsk_..." > .env
# optional: set a public URL
echo "PUBLIC_URL=https://yourdomain.com" >> .env

# 2. run it
docker compose up -d --build
```

Open **http://localhost:3000** (or your domain).

## Required configuration

| Setting | Where | Needed for |
|---|---|---|
| `GROQ_API_KEY` | `backend/.env` or `.env` (Docker) | AI chat. Free at https://console.groq.com |
| `PUBLIC_URL` | `backend/.env` | Product & share links sent to customers |
| `JWT_SECRET` | `backend/.env` | Login security — change it |
| Owner WhatsApp number | Settings page | Order alerts + human handover |

## Setup checklist (first time)

1. Create an account at `/register`.
2. **Connect WhatsApp** (`/connect`) — click *Start connection*, scan the QR with WhatsApp (Linked devices) *or* enter the pairing PIN.
3. **Add products** (`/catalog`) — name, price, description, image. If your number is **WhatsApp Business with a catalog**, hit *Sync from WhatsApp Catalog* to import your existing products automatically (works for WhatsApp Business accounts only — personal numbers have no catalog).
4. Set the **owner WhatsApp number** (`/settings`) so order alerts arrive on your phone.
5. Open the store — the dashboard toggle controls the session.
6. Share your page (`/share`) and start selling.

## How the AI decides

The bot is asked to always reply in JSON with three fields:

```json
{ "reply": "...", "action": "none | order | handover", "customerName": "", "order": { "items": [], "total": 0 } }
```

- `order` → order is saved, the owner is notified on WhatsApp, customer gets confirmation.
- `handover` → bot tells the customer a human will help, forwards to the owner, flags the conversation in the Inbox.
- On any AI/API error the bot **automatically hands over to a human** — it never leaves a customer stuck.

## Project structure

```
backend/
  src/
    config/        env + auto DB
    models/        User, Business, CatalogItem, Order, ChatMessage, SessionLog
    routes/        auth, business, catalog, orders, dashboard, inbox, public pages
    services/      whatsappManager (QR/PIN, message pipeline), groq
    ai/            salesAgent (prompt + JSON actions)
frontend/
  src/             React dashboard (Vite)
wdata/             WhatsApp session data (created at runtime)
docker-compose.yml
Dockerfile
```

## Sellable ideas

- White-label per-tenant signup is already in place (each account gets its own business + WhatsApp session).
- Add billing (Stripe) with plan tiers; the model already separates `admin` and `business` roles.
- Each business gets its own bot session, catalog, orders and dashboard automatically.

> ⚠️ whatsapp-web.js is an unofficial library. Use a dedicated number, respect WhatsApp's terms (no spam), and expect occasional re-linking after app updates. **QR login is the most reliable method.** Pairing PIN is supported, but WhatsApp occasionally rate-limits pairing-code generation; if a code can't be generated the page offers a clear "scan the QR instead" fallback.
