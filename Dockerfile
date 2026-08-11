# ---- Stage 1: build the React dashboard ----
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY frontend/package.json ./frontend/package.json
RUN cd frontend && npm install --no-audit --no-fund
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- Stage 2: runtime (Node + Chromium for WhatsApp) ----
FROM node:20-bookworm-slim AS api
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production

# Chromium + dependencies required by whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 \
    libgdk-pixbuf-2.0-0 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --no-audit --no-fund
COPY backend ./backend
COPY --from=web /app/frontend/dist ./frontend/dist

ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "backend/src/index.js"]
