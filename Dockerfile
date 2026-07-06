# syntax=docker/dockerfile:1

# =============================================================
# VAPTBOOSTER web (Next.js) — production image
# Multi-stage build using Next.js "standalone" output. The app is
# DB-backed (Prisma), so the Prisma client/engine must be generated
# and openssl present at runtime (Alpine/musl).
# =============================================================

# ---- deps: install all dependencies (dev deps needed to build) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` when the lock is in sync; fall back to `npm install` to tolerate
# cross-platform optional-dep drift (Windows-generated lock on a Linux build).
RUN npm ci || npm install

# ---- builder: generate Prisma client + compile the Next.js app ----
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client (musl engine) with the schema present.
RUN npx prisma generate
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# openssl is required by the Prisma query engine on Alpine/musl.
RUN apk add --no-cache openssl

# Run as an unprivileged user.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 nextjs

# Static assets + the self-contained standalone server.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Ensure the generated Prisma client + engine are present for the runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
