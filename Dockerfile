# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BYFINITY_HOST=127.0.0.1 \
    BYFINITY_PORT=4179 \
    HERMES_URL=http://127.0.0.1:9119 \
    BYFINITY_CONFIG_FILE=/var/lib/byfinity-bots/config/connection.json \
    BYFINITY_HERMES_EXCHANGE_DIR=/var/lib/byfinity-bots/exchange
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && install -d -o node -g node /var/lib/byfinity-bots/config /var/lib/byfinity-bots/exchange
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4179/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
