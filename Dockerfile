# Multi-stage production Dockerfile for Next.js App Router (Saarthi)

# 1. Base Image
FROM node:20-alpine AS base

# 2. Install Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# 3. Build Application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_ci_placeholder"
ENV CLERK_SECRET_KEY="sk_test_ci_placeholder"
ENV NEXT_PUBLIC_NEON_DB_CONNECTION_STRING="postgresql://user:pass@localhost:5432/db"
ENV GROQ_API_KEY="gsk_ci_placeholder"
ENV MY_AWS_REGION="us-east-1"
ENV MY_AWS_ACCESS_KEY_ID="AKIA_CI_PLACEHOLDER"
ENV MY_AWS_SECRET_ACCESS_KEY="ci_placeholder_secret"

RUN npm run build

# 4. Production Runner Stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Copy standalone build artifacts
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
