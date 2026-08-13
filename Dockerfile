# ---- Stage 1: build the React dashboard ----
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY frontend/package.json ./frontend/package.json
RUN cd frontend && npm install --no-audit --no-fund
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- Stage 2: runtime (Node only — Baileys uses WebSocket, no browser) ----
FROM node:20-bookworm-slim AS api
ENV NODE_ENV=production

WORKDIR /app
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --no-audit --no-fund
COPY backend ./backend
COPY --from=web /app/frontend/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "backend/src/index.js"]
