# =============================================================================
# Base: dependencies + Prisma client (shared by dev and prod)
# =============================================================================
FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY .env.build ./

RUN npm install --ignore-scripts \
  && set -a && . ./.env.build && set +a \
  && npx prisma generate \
  && rm -f .env.build

# =============================================================================
# Development: tsx watch (hot reload). Compose uses: target: development
# =============================================================================
FROM base AS development

COPY docker-entrypoint-dev.sh /usr/local/bin/docker-entrypoint-dev.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-dev.sh

ENV NODE_ENV=development

EXPOSE 4000

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint-dev.sh"]

# =============================================================================
# Production: tsc + node (default `docker build` final stage)
# =============================================================================
FROM base AS production

RUN npm run build

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 4000

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
