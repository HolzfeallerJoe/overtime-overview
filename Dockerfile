# Overtime dashboard: server/serve.cjs, which regenerates the page from
# Clockify on startup and once a day at REFRESH_AT. See docker-compose.yml.
FROM node:22-alpine

WORKDIR /app
RUN chown node:node /app
USER node

# Everything is copied --chown: the folder on the host may belong to anyone
# with any mode (a NAS dataset owned by its admin, say), and the build reads it
# as root - but the server runs as node and must be able to read all of it.

# tsx is a devDependency but the server needs it at runtime to run
# scripts/dashboard.ts, so install everything.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

# The rest of the folder, minus .dockerignore. That includes the absence files
# (.cache/absences.json, absences.local.json) when present: SEED_DIR=/app makes
# the server take them into the data volume on its first start.
COPY --chown=node:node . .

# Generated output lives in the container. The absence data lives in
# /app/data, a volume - created here so a fresh volume inherits the node owner.
RUN mkdir -p www out data/.cache

ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    SEED_DIR=/app
EXPOSE 8080

CMD ["node", "server/serve.cjs"]
