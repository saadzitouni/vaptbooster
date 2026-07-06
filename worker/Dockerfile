# syntax=docker/dockerfile:1
# =============================================================
# VAPTBOOSTER scan worker — production image.
# Build context is the REPO ROOT (needs prisma/schema.prisma to
# generate the client): docker build -f worker/Dockerfile .
# =============================================================

FROM node:22-alpine AS build
WORKDIR /app/worker
ENV NODE_ENV=production
# openssl is required by the Prisma engines on Alpine/musl.
RUN apk add --no-cache openssl

# Install worker deps (incl. tsx to run the TS entrypoint). --include=dev so
# tsx isn't dropped under NODE_ENV=production on the install fallback.
COPY worker/package.json worker/package-lock.json* ./
RUN npm ci --include=dev || npm install --include=dev

# Generate the Prisma client from the shared schema. Keep the schema next to
# the worker's node_modules so prisma resolves @prisma/client, and pin the CLI
# (worker deps don't include it, so a bare `npx prisma` fetches the latest major
# and rejects the v5 schema).
COPY prisma ./prisma
RUN npx --yes prisma@5.22.0 generate --schema=./prisma/schema.prisma

# Worker source.
COPY worker/tsconfig.json ./
COPY worker/src ./src

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app/worker
ENV NODE_ENV=production
RUN apk add --no-cache openssl
# Brings node_modules (with the generated client), prisma/, and src.
COPY --from=build /app/worker ./
USER node
# The worker reads REDIS_URL / DATABASE_URL / LITELLM_* / SIMULATE_LLM from env.
CMD ["npm", "run", "start"]
