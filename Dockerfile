FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 VIRA_DATA_DIR=/var/lib/vira VIRA_INTERNAL_INGEST_ENABLED=false VIRA_MARKET_ROUNDS_ENABLED=false VIRA_FOOTBALL_ROUND_COOLDOWN_SEC=240 VIRA_FOOTBALL_ROUNDS_MAX=7
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY backend ./backend
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8787/ready || exit 1
CMD ["node", "backend/server.mjs"]
